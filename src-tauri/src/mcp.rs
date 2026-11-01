//! Native Streamable HTTP MCP, served directly by the single editor process.
use crate::{
    launch::{Options, DEFAULT_MCP_PORT},
    storage, Native, Request,
};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use rmcp::{
    model::*,
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager,
        tower::{StreamableHttpServerConfig, StreamableHttpService},
    },
    ErrorData, RoleServer, ServerHandler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(test)]
use std::path::Path;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Weak},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub url: String,
    pub mcp_url: String,
    pub token: String,
    pub pid: u32,
    pub port: u16,
    pub instance: String,
    pub version: String,
}
impl Connection {
    #[cfg(test)]
    pub fn read(path: &Path) -> Option<Self> {
        let value: Self = storage::json(path)?;
        for (address, route) in [(&value.url, "/rpc"), (&value.mcp_url, "/mcp")] {
            let url = url::Url::parse(address).ok()?;
            if url.scheme() != "http"
                || url.host_str() != Some("127.0.0.1")
                || url.port_or_known_default() != Some(value.port)
                || url.path() != route
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return None;
            }
        }
        if value.token.len() != 64 || !value.token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        Some(value)
    }
}
pub fn connection_path() -> PathBuf {
    std::env::var_os("PIXPRITE_CONNECTION_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".pixprite/connection.json"))
}
pub fn profile() -> PathBuf {
    storage::profile().join(if std::env::var_os("PIXPRITE_USER_DATA").is_some() {
        ""
    } else {
        "Tauri"
    })
}
fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
struct Server {
    connection: Connection,
    path: PathBuf,
    shutdown: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.shutdown.cancel();
        self.task.abort();
        if storage::json::<Connection>(&self.path)
            .is_some_and(|value| value.instance == self.connection.instance)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}
pub struct Runtime {
    override_enabled: Option<bool>,
    port_override: Option<u16>,
    server: Option<Server>,
    error: Option<String>,
}
impl Runtime {
    pub fn new(options: &Options) -> Self {
        Self {
            override_enabled: if options.no_mcp {
                Some(false)
            } else if options.mcp {
                Some(true)
            } else {
                None
            },
            port_override: options.port,
            server: None,
            error: None,
        }
    }
    pub fn apply_cli(&mut self, options: &Options) {
        if options.no_mcp {
            self.override_enabled = Some(false);
            self.port_override = None;
        } else if options.mcp {
            self.override_enabled = Some(true);
            if options.port.is_some() {
                self.port_override = options.port;
            }
        }
    }
    async fn stop(&mut self) {
        if let Some(mut server) = self.server.take() {
            server.shutdown.cancel();
            server.task.abort();
            let _ = (&mut server.task).await;
        }
    }
}
pub async fn synchronize(state: Arc<Native>) -> Value {
    let mut runtime = state.mcp.lock().await;
    let (enabled, configured_port) = {
        let config = state.config.lock().unwrap();
        (
            config["mcpEnabled"].as_bool().unwrap_or(false),
            config["mcpPort"]
                .as_u64()
                .and_then(|value| u16::try_from(value).ok())
                .unwrap_or(DEFAULT_MCP_PORT),
        )
    };
    if runtime
        .server
        .as_ref()
        .is_some_and(|server| server.task.inner().is_finished())
    {
        runtime.stop().await;
    }
    let wanted = runtime.override_enabled.unwrap_or(enabled)
        && state.open.load(std::sync::atomic::Ordering::SeqCst);
    runtime.error = None;
    if !wanted {
        runtime.stop().await;
        *state.connection.lock().unwrap() = None;
    } else if runtime.server.is_none() {
        match start(&state, runtime.port_override.unwrap_or(configured_port)).await {
            Ok(server) => runtime.server = Some(server),
            Err(error) => runtime.error = Some(error),
        }
    }
    if let Some(server) = &runtime.server {
        if runtime
            .port_override
            .is_some_and(|requested| requested != 0 && requested != server.connection.port)
        {
            runtime.error = Some(format!(
                "MCP is already running on port {}. The requested port was not applied.",
                server.connection.port
            ));
        }
    }
    json!({"enabled":enabled, "forced":runtime.override_enabled == Some(true), "blocked":runtime.override_enabled == Some(false), "running":runtime.server.is_some(),
        "url":runtime.server.as_ref().map(|server| &server.connection.mcp_url), "token":runtime.server.as_ref().map(|server| &server.connection.token),
        "serverPid":runtime.server.as_ref().map(|server| server.connection.pid), "port":configured_port,
        "activePort":runtime.server.as_ref().map(|server| server.connection.port), "connectionFile":state.connection_file, "error":runtime.error})
}
#[derive(Clone)]
struct Transport {
    native: Weak<Native>,
    connection: Connection,
    shutdown: CancellationToken,
}
struct ToolEntry {
    tool: Tool,
    method: String,
    validator: jsonschema::Validator,
}
fn catalog() -> &'static Vec<ToolEntry> {
    static TOOLS: std::sync::OnceLock<Vec<ToolEntry>> = std::sync::OnceLock::new();
    TOOLS.get_or_init(|| {
        let values: Vec<Value> =
            serde_json::from_str(include_str!("../../dist/desktop/mcp-tools.json"))
                .expect("Embedded tool catalog");
        values
            .into_iter()
            .map(|value| ToolEntry {
                tool: serde_json::from_value(value.clone()).expect("Tool definition"),
                method: value["method"].as_str().unwrap().to_owned(),
                validator: jsonschema::validator_for(&value["inputSchema"])
                    .expect("Tool argument schema"),
            })
            .collect()
    })
}
#[derive(Clone)]
struct McpHandler(Weak<Native>);
impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new("pixprite", crate::updates::CURRENT_VERSION);
        info.instructions = Some("Pixprite uses one editor window. Use pixprite_documents to discover its open documents and pixprite_select to activate a document.".into());
        info
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut result = ListToolsResult::default();
        result.tools = catalog().iter().map(|entry| entry.tool.clone()).collect();
        Ok(result)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let Some(entry) = catalog()
            .iter()
            .find(|entry| entry.tool.name == request.name)
        else {
            return Err(ErrorData::invalid_params("Unknown tool", None));
        };
        let mut args = Value::Object(request.arguments.unwrap_or_default());
        if let Err(error) = entry.validator.validate(&args) {
            return Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                "Invalid arguments: {error}"
            ))])
            .into());
        }
        // JSON Schema describes defaults; apply the catalog's top-level defaults before dispatching.
        if let Some(properties) = entry
            .tool
            .input_schema
            .get("properties")
            .and_then(Value::as_object)
        {
            for (key, schema) in properties {
                if args.get(key).is_none() {
                    if let Some(default) = schema.get("default") {
                        args[key] = default.clone();
                    }
                }
            }
        }
        let native = self
            .0
            .upgrade()
            .ok_or_else(|| ErrorData::internal_error("Editor is closed", None))?;
        let result = match native
            .dispatch(Request {
                method: entry.method.clone(),
                params: args,
            })
            .await
        {
            Ok(value) => match value.get("image").and_then(Value::as_str) {
                Some(data) => CallToolResult::success(vec![ContentBlock::image(data, "image/png")]),
                None => CallToolResult::success(vec![ContentBlock::text(value.to_string())]),
            },
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        };
        Ok(result.into())
    }
}

async fn authorize(
    State(transport): State<Transport>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if transport.shutdown.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let headers = request.headers();
    let expected = format!("127.0.0.1:{}", transport.connection.port);
    let host = headers.get("host").and_then(|value| value.to_str().ok());
    if headers.contains_key("origin")
        || !(host == Some(expected.as_str())
            || (transport.connection.port == 80 && host == Some("127.0.0.1")))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some(&format!("Bearer {}", transport.connection.token))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}
async fn raw_rpc(State(transport): State<Transport>, Json(request): Json<Request>) -> Response {
    let Some(native) = transport.native.upgrade() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match native.dispatch(request).await {
        Ok(result) => Json(json!({"result":result})).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"error":error}))).into_response(),
    }
}
async fn start(state: &Arc<Native>, port: u16) -> Result<Server, String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Could not bind MCP port {port}: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token_path = state.profile.join("mcp-token.json");
    let token = storage::json::<String>(&token_path)
        .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_else(random_token);
    storage::atomic_json(&token_path, &token)?;
    let connection = Connection {
        url: format!("http://127.0.0.1:{port}/rpc"),
        mcp_url: format!("http://127.0.0.1:{port}/mcp"),
        token,
        pid: std::process::id(),
        port,
        instance: uuid::Uuid::new_v4().to_string(),
        version: crate::updates::CURRENT_VERSION.into(),
    };
    let shutdown = CancellationToken::new();
    let native = Arc::downgrade(state);
    let transport = Transport {
        native: native.clone(),
        connection: connection.clone(),
        shutdown: shutdown.clone(),
    };
    let mut config = StreamableHttpServerConfig::default();
    config.legacy_session_mode = false;
    config.json_response = true;
    config.cancellation_token = shutdown.clone();
    config.max_request_body_bytes = 8 * 1024 * 1024;
    config.allowed_hosts = vec![format!("127.0.0.1:{port}")];
    if port == 80 {
        config.allowed_hosts.push("127.0.0.1".into());
    }
    let service = StreamableHttpService::new(
        move || Ok(McpHandler(native.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let router = Router::new()
        .route("/rpc", post(raw_rpc))
        .nest_service("/mcp", service)
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(transport.clone(), authorize))
        .with_state(transport);
    let path = state.connection_file.clone();
    if let Some(parent) = path.parent() {
        storage::private_dir(parent).map_err(|e| e.to_string())?;
    }
    storage::atomic_json(&path, &connection)?;
    *state.connection.lock().unwrap() = Some((path.clone(), connection.instance.clone()));
    let done = shutdown.clone();
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(done.cancelled_owned())
            .await
        {
            eprintln!("MCP transport: {error}");
        }
    });
    Ok(Server {
        connection,
        path,
        shutdown,
        task,
    })
}
#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;
