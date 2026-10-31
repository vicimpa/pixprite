#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod frame_pacing;
mod library;
mod storage;
mod system;
use system::{desktop_copy_image, desktop_paste_image, desktop_save_download, desktop_text_action};
mod updates;
use axum::{
    extract::{DefaultBodyLimit, State as HttpState},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{
    Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::oneshot;
use updates::{UpdateState, CURRENT_VERSION};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Request {
    method: String,
    #[serde(default = "empty_params")]
    params: Value,
}
fn empty_params() -> Value {
    json!({})
}
struct Native {
    app: OnceLock<tauri::AppHandle>,
    profile: PathBuf,
    library: Mutex<library::Library>,
    config: Mutex<Value>,
    config_write: Mutex<()>,
    save_changes: tokio::sync::watch::Sender<()>,
    update: Mutex<UpdateState>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    files: Mutex<Vec<PathBuf>>,
    ready: AtomicBool,
    closing: AtomicBool,
    allow_close: AtomicBool,
    allow_exit: AtomicBool,
    checking: AtomicBool,
    connection: Mutex<Option<(PathBuf, String)>>,
}
impl Native {
    fn app(&self) -> &tauri::AppHandle {
        self.app.get().expect("Native app initialized")
    }
    fn notice(&self, message: impl ToString) {
        eprintln!("{}", message.to_string());
        let _ = self
            .app()
            .emit_to("main", "pixprite-notice", message.to_string());
    }
    fn save(&self) -> Result<(), String> {
        let _writing = self.config_write.lock().unwrap();
        let snapshot = self.config.lock().unwrap().clone();
        storage::atomic_json(&self.profile.join("window.json"), &snapshot)
    }

    async fn request(&self, request: Request) -> Result<Value, String> {
        if !self.ready.load(Ordering::SeqCst) {
            return Err("Pixprite editor is still starting; retry shortly".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let result = if let Err(error) = self.app().emit_to(
            "main",
            "pixprite-request",
            json!({"id":id,"request":request}),
        ) {
            Err(error.to_string())
        } else {
            tokio::time::timeout(Duration::from_secs(35), rx)
                .await
                .map_err(|_| "Editor request timed out".to_string())
                .and_then(|v| v.map_err(|_| "Editor request was interrupted".into()))
                .and_then(|v| v)
        };
        self.pending.lock().unwrap().remove(&id);
        result
    }
    fn flush_files(&self) {
        if !self.ready.load(Ordering::SeqCst) {
            return;
        }
        let paths = std::mem::take(&mut *self.files.lock().unwrap());
        let mut files = Vec::new();
        for path in paths {
            match storage::read_document(&path) {
                Ok(file) => files.push(file),
                Err(error) => self.notice(error),
            }
        }
        if !files.is_empty() {
            let _ = self.app().emit_to("main", "pixprite-files", files);
        }
    }
    fn show(&self) {
        if let Some(window) = self.app().get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    async fn dispatch(&self, mut request: Request) -> Result<Value, String> {
        if request.method == "update_state" {
            return Ok(json!(*self.update.lock().unwrap()));
        }
        if request.method == "update_action" {
            let window = self
                .app()
                .get_webview_window("main")
                .ok_or("Editor is closed")?;
            let state = self.app().state::<Arc<Native>>();
            desktop_update(
                window,
                state,
                request.params["action"]
                    .as_str()
                    .ok_or("Missing action")?
                    .to_owned(),
            )
            .await?;
            return Ok(json!(*self.update.lock().unwrap()));
        }
        if request.method == "desktop_info" {
            return Ok(
                json!({"runtime":"tauri","framePacing":frame_pacing::policy(),"version":CURRENT_VERSION,"windows":self.app().webview_windows().len(),"menu":self.app().menu().is_some(),"window":self.app().get_webview_window("main").map(|w|window_state(&w))}),
            );
        }
        if request.method == "window_action" {
            let window = self
                .app()
                .get_webview_window("main")
                .ok_or("Editor is closed")?;
            if request.params["action"].as_str() == Some("resize") {
                let width = request.params["width"]
                    .as_u64()
                    .filter(|v| (800..=3840).contains(v))
                    .ok_or("width must be 800..3840")?;
                let height = request.params["height"]
                    .as_u64()
                    .filter(|v| (600..=2160).contains(v))
                    .ok_or("height must be 600..2160")?;
                window
                    .set_size(tauri::LogicalSize::new(width as f64, height as f64))
                    .map_err(|e| e.to_string())?;
            } else {
                window_action(
                    &window,
                    request.params["action"].as_str().ok_or("Missing action")?,
                )?;
            }
            return Ok(window_state(&window));
        }
        if request.method == "shutdown" {
            self.request(Request {
                method: "prepare_close".into(),
                params: Value::Null,
            })
            .await?;
            self.save()?;
            self.allow_exit.store(true, Ordering::SeqCst);
            self.app().exit(0);
            return Ok(json!({"saved":true}));
        }
        if request.method == "select" {
            self.show();
        }
        if request.method == "open_file" {
            let file = storage::read_document(Path::new(
                request.params["path"]
                    .as_str()
                    .ok_or("path must be a string")?,
            ))?;
            request = Request {
                method: "open_data".into(),
                params: file,
            };
        }
        if request.method != "save_file" {
            return self.request(request).await;
        }
        let path = PathBuf::from(
            request.params["path"]
                .as_str()
                .ok_or("path must be a string")?,
        );
        if !path.is_absolute() {
            return Err("Expected an absolute file path".into());
        }
        let overwrite = request
            .params
            .get("overwrite")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let format = if ext == "ase" { "aseprite" } else { &ext };
        if !["pixprite", "aseprite", "png"].contains(&format) {
            return Err("Save supports .pixprite, .aseprite/.ase and .png".into());
        }
        let result = self
            .request(Request {
                method: "export_data".into(),
                params: json!({"format":format}),
            })
            .await?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(result["data"].as_str().ok_or("Invalid export response")?)
            .map_err(|e| e.to_string())?;
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let write = (|| {
            storage::atomic_bytes(&temporary, &bytes).map_err(|e| e.to_string())?;
            if overwrite {
                fs::rename(&temporary, &path)
            } else {
                fs::hard_link(&temporary, &path)
            }
            .map_err(|e| e.to_string())
        })();
        let _ = fs::remove_file(temporary);
        write?;
        Ok(json!({"path":path,"format":format,"bytes":bytes.len()}))
    }
    fn cleanup(&self) {
        if let Some((path, token)) = &*self.connection.lock().unwrap() {
            if storage::json::<Value>(path).is_some_and(|v| v["token"] == *token) {
                let _ = fs::remove_file(path);
            }
        }
    }
}
fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("Forbidden".into())
    } else {
        Ok(())
    }
}
fn window_state(window: &WebviewWindow) -> Value {
    json!({"maximized":window.is_maximized().unwrap_or(false),"fullscreen":window.is_fullscreen().unwrap_or(false),"focused":window.is_focused().unwrap_or(false)})
}
fn window_action(window: &WebviewWindow, action: &str) -> Result<(), String> {
    let result = match action {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "fullscreen" => window.set_fullscreen(!window.is_fullscreen().unwrap_or(false)),
        "close" => window.close(),
        "drag" => window.start_dragging(),
        _ => return Err("Unknown window action".into()),
    };
    result.map_err(|e| e.to_string())
}
#[tauri::command]
async fn desktop_library(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    trusted(&window)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(value) => {
            serde_json::to_vec(value).map_err(|e| e.to_string())?
        }
    };
    let native = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let request = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        native
            .library
            .lock()
            .map_err(|_| "Library lock poisoned")?
            .execute(request)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn desktop_bootstrap(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
) -> Result<Value, String> {
    trusted(&window)?;
    let migration = state.profile.join("electron-migration.json");
    let dump = if migration.is_file() {
        if fs::metadata(&migration).map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
            return Err("Electron backup exceeds 256 MiB".into());
        }
        storage::json::<Value>(&migration)
    } else {
        None
    };
    let mut recovery = state.config.lock().unwrap()["recovery"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if let Some(values) = dump.as_ref().and_then(|d| d["localStorage"].as_object()) {
        for key in values.keys() {
            if let Some(id) = key.strip_prefix("pixprite:session:window:") {
                if uuid::Uuid::parse_str(id).is_ok() {
                    recovery.push(json!(id));
                }
            }
        }
        state.config.lock().unwrap()["recovery"] = json!(recovery);
    }
    Ok(
        json!({"platform":if cfg!(target_os="macos"){"darwin"}else if cfg!(target_os="windows"){"win32"}else{"linux"},"recovery":recovery,"migration":dump}),
    )
}
#[tauri::command]
fn desktop_migration_complete(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    let path = state.profile.join("electron-migration.json");
    let dump: Value = storage::json(&path).ok_or("Missing migration file")?;
    if dump["id"] != id {
        return Err("Migration ID mismatch".into());
    }
    fs::rename(
        path,
        state
            .profile
            .join(format!("electron-migration-{id}.imported.json")),
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn desktop_session(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    session: Value,
) -> Result<(), String> {
    trusted(&window)?;
    if !session["tabs"].as_array().is_some_and(|ids| {
        ids.iter()
            .all(|v| v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 256))
    }) || !(session["active"].is_null() || session["active"].is_string())
    {
        return Err("Invalid window session".into());
    }
    state.config.lock().unwrap()["session"] = session;
    state.save()
}
#[tauri::command]
fn desktop_sessions(window: WebviewWindow, state: State<'_, Arc<Native>>) -> Result<Value, String> {
    trusted(&window)?;
    let config = state.config.lock().unwrap();
    let mut sessions = config["sessions"].as_object().cloned().unwrap_or_default();
    if !config["session"].is_null() {
        sessions.insert("main".into(), config["session"].clone());
    }
    Ok(json!(sessions))
}
#[tauri::command]
async fn desktop_recovered(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    ids: Vec<String>,
) -> Result<(), String> {
    trusted(&window)?;
    {
        let mut config = state.config.lock().unwrap();
        let recovery = config["recovery"].as_array().cloned().unwrap_or_default();
        config["recovery"] = json!(recovery
            .into_iter()
            .filter(|v| !ids.iter().any(|id| v == id))
            .collect::<Vec<_>>());
        if let Some(sessions) = config["sessions"].as_object_mut() {
            for id in ids {
                sessions.remove(&id);
            }
        }
    }
    state.save()
}
#[tauri::command]
fn desktop_window_state(window: WebviewWindow) -> Result<Value, String> {
    trusted(&window)?;
    Ok(window_state(&window))
}
#[tauri::command]
fn desktop_window(window: WebviewWindow, action: String) -> Result<(), String> {
    trusted(&window)?;
    window_action(&window, &action)
}
#[tauri::command]
fn desktop_reply(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    trusted(&window)?;
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}
#[tauri::command]
fn desktop_ready(window: WebviewWindow, state: State<'_, Arc<Native>>) -> Result<(), String> {
    trusted(&window)?;
    state.ready.store(true, Ordering::SeqCst);
    state.flush_files();
    Ok(())
}
#[tauri::command]
fn desktop_language(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    language: String,
) -> Result<(), String> {
    trusted(&window)?;
    storage::atomic_json(&state.profile.join("language.json"), &language)
}
#[tauri::command]
fn desktop_update_state(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
) -> Result<Value, String> {
    trusted(&window)?;
    Ok(json!(*state.update.lock().unwrap()))
}
#[tauri::command]
async fn desktop_update(
    window: WebviewWindow,
    state: State<'_, Arc<Native>>,
    action: String,
) -> Result<(), String> {
    trusted(&window)?;
    let state = state.inner().clone();
    match action.as_str() {
        "check" => check_updates(state).await,
        "open" => {
            let url = state
                .update
                .lock()
                .unwrap()
                .url
                .clone()
                .ok_or("No new release is available")?;
            open::that(url).map_err(|e| e.to_string())
        }
        _ => Err("Unknown update action".into()),
    }
}

#[tauri::command]
async fn desktop_quit(window: WebviewWindow, state: State<'_, Arc<Native>>) -> Result<(), String> {
    trusted(&window)?;
    state
        .request(Request {
            method: "prepare_close".into(),
            params: Value::Null,
        })
        .await?;
    state.save()?;
    state.allow_exit.store(true, Ordering::SeqCst);
    state.app().exit(0);
    Ok(())
}
async fn check_updates(state: Arc<Native>) -> Result<(), String> {
    if std::env::var("PIXPRITE_DISABLE_UPDATES").as_deref() == Ok("1")
        || cfg!(debug_assertions) && std::env::var("PIXPRITE_UPDATE_URL").is_err()
    {
        return Ok(());
    }
    if state.checking.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = updates::check().await;
    match &result {
        Ok(value) => {
            *state.update.lock().unwrap() = value.clone();
            let _ = state.app().emit_to("main", "pixprite-update", value);
        }
        // Offline and rate-limited checks stay silent and preserve an existing notification.
        Err(error) => eprintln!("Release check: {error}"),
    }
    state.checking.store(false, Ordering::SeqCst);
    result.map(|_| ())
}
async fn start_rpc(state: Arc<Native>) -> Result<(), String> {
    use rand::RngCore;
    let mut token = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut token);
    let token = hex::encode(token);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    #[derive(Clone)]
    struct Auth {
        native: Arc<Native>,
        token: String,
        host: String,
    }
    async fn rpc(
        HttpState(auth): HttpState<Auth>,
        headers: HeaderMap,
        body: Result<Json<Request>, axum::extract::rejection::JsonRejection>,
    ) -> (StatusCode, Json<Value>) {
        if headers.contains_key("origin")
            || headers.get("host").and_then(|v| v.to_str().ok()) != Some(&auth.host)
            || headers.get("authorization").and_then(|v| v.to_str().ok())
                != Some(&format!("Bearer {}", auth.token))
        {
            return (StatusCode::FORBIDDEN, Json(json!({"error":"Forbidden"})));
        }
        let request = match body {
            Ok(Json(v)) => v,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error":e.to_string()})),
                )
            }
        };
        match auth.native.dispatch(request).await {
            Ok(result) => (StatusCode::OK, Json(json!({"result":result}))),
            Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"error":error}))),
        }
    }
    let path = std::env::var_os("PIXPRITE_CONNECTION_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".pixprite/connection.json"));
    if std::env::var_os("PIXPRITE_CONNECTION_FILE").is_none() {
        storage::private_dir(path.parent().ok_or("Missing discovery parent")?)
            .map_err(|e| e.to_string())?;
    }
    let mcp = state.profile.join("automation/mcp.mjs");
    let payload = include_bytes!("../../dist/desktop/mcp-builtin.mjs").to_vec();
    storage::atomic_bytes(&mcp, &payload).map_err(|e| e.to_string())?;
    storage::atomic_json(
        &path,
        &json!({"url":format!("http://127.0.0.1:{port}/rpc"),"token":token,"pid":std::process::id(),"mcpPath":mcp,"mcpSha256":updates::hash(&payload),"version":CURRENT_VERSION}),
    )?;
    *state.connection.lock().unwrap() = Some((path, token.clone()));
    let router = Router::new()
        .route("/rpc", post(rpc))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .with_state(Auth {
            native: state,
            token,
            host: format!("127.0.0.1:{port}"),
        });
    axum::serve(listener, router)
        .await
        .map_err(|e| e.to_string())
}
fn create_window(app: &tauri::AppHandle, state: Arc<Native>) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    state.ready.store(false, Ordering::SeqCst);
    state.allow_close.store(false, Ordering::SeqCst);
    state.closing.store(false, Ordering::SeqCst);
    let nav_state = state.clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Pixprite")
        .inner_size(1280., 900.)
        .min_inner_size(800., 600.)
        .decorations(false)
        .shadow(true)
        .background_color(tauri::window::Color(35, 31, 43, 255))
        .initialization_script_for_all_frames(
            &include_str!("../../dist/desktop/bridge.js").replace(
                "__PIXPRITE_SHORTCUT_TOKEN__",
                &uuid::Uuid::new_v4().to_string(),
            ),
        )
        .data_directory(state.profile.join("webview"))
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_navigation(move |url| {
            let local = matches!(url.as_str(), "about:blank" | "about:srcdoc")
                || url.scheme() == "tauri" && url.host_str() == Some("localhost")
                || url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
                || cfg!(debug_assertions)
                    && url.scheme() == "http"
                    && url.host_str() == Some("localhost")
                    && url.port() == Some(3355);
            if !local && matches!(url.scheme(), "https" | "http") {
                let _ = open::that(url.as_str());
            }
            if !local {
                nav_state.notice("External navigation opened in the browser");
            }
            local
        })
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "https" | "http") {
                let _ = open::that(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        });
    #[cfg(target_os = "macos")]
    if std::env::var_os("PIXPRITE_USER_DATA").is_some() {
        use sha2::Digest;
        let hash = sha2::Sha256::digest(state.profile.to_string_lossy().as_bytes());
        let mut id = [0u8; 16];
        id.copy_from_slice(&hash[..16]);
        builder = builder.data_store_identifier(id);
    }
    if let Some(bounds) = state.config.lock().unwrap()["bounds"].as_object() {
        if let (Some(w), Some(h)) = (
            bounds.get("width").and_then(Value::as_f64),
            bounds.get("height").and_then(Value::as_f64),
        ) {
            builder = builder.inner_size(w.clamp(800., 3840.), h.clamp(600., 2160.));
        }
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if let Err(error) = frame_pacing::configure(&window) {
        eprintln!("Frame pacing configuration: {error}");
    }
    let event_state = state.clone();
    let event_window = window.clone();
    let previous_window_state = Mutex::new(window_state(&window));
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if event_state.allow_close.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if event_state.closing.swap(true, Ordering::SeqCst) {
                return;
            }
            let state = event_state.clone();
            let window = event_window.clone();
            tauri::async_runtime::spawn(async move {
                let saved = if state.ready.load(Ordering::SeqCst) {
                    state
                        .request(Request {
                            method: "prepare_close".into(),
                            params: Value::Null,
                        })
                        .await
                        .map(|_| ())
                } else {
                    Ok(())
                };
                match saved.and_then(|_| state.save()) {
                    Ok(()) => {
                        state.allow_close.store(true, Ordering::SeqCst);
                        state.ready.store(false, Ordering::SeqCst);
                        let _ = window.close();
                    }
                    Err(error) => {
                        state.closing.store(false, Ordering::SeqCst);
                        state.notice(error);
                    }
                }
            });
        }
        if let WindowEvent::Resized(size) = event {
            if !event_window.is_maximized().unwrap_or(false)
                && !event_window.is_fullscreen().unwrap_or(false)
            {
                let scale = event_window.scale_factor().unwrap_or(1.);
                let bounds =
                    json!({"width":size.width as f64/scale,"height":size.height as f64/scale});
                let mut config = event_state.config.lock().unwrap();
                if config["bounds"] != bounds {
                    config["bounds"] = bounds;
                    event_state.save_changes.send_replace(());
                }
            }
        }
        // Position changes need neither a WebView message nor a synchronous disk write.
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_)) {
            let next = window_state(&event_window);
            let mut previous = previous_window_state.lock().unwrap();
            if *previous != next {
                *previous = next.clone();
                let _ = event_window.emit("pixprite-window", next);
            }
        }
    });
    Ok(window)
}
fn main() {
    let profile = storage::profile().join(if std::env::var_os("PIXPRITE_USER_DATA").is_some() {
        ""
    } else {
        "Tauri"
    });
    storage::private_dir(&profile).expect("Create private app directory");
    let state = Arc::new(Native {
        app: OnceLock::new(),
        profile: profile.clone(),
        library: Mutex::new(
            library::Library::new(storage::data_directory().expect("Locate library"))
                .expect("Create library"),
        ),
        config: Mutex::new(storage::json(&profile.join("window.json")).unwrap_or(json!({}))),
        config_write: Mutex::new(()),
        save_changes: tokio::sync::watch::channel(()).0,
        update: Mutex::new(UpdateState::default()),
        pending: Mutex::new(HashMap::new()),
        files: Mutex::new(
            std::env::args_os()
                .skip(1)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute() && storage::supported(p))
                .collect(),
        ),
        ready: AtomicBool::new(false),
        closing: AtomicBool::new(false),
        allow_close: AtomicBool::new(false),
        allow_exit: AtomicBool::new(false),
        checking: AtomicBool::new(false),
        connection: Mutex::new(None),
    });
    let setup = state.clone();
    let single = state.clone();
    let mut context = tauri::generate_context!();
    // Isolated profiles must never activate a running production instance during tests or migration.
    if std::env::var_os("PIXPRITE_USER_DATA").is_some() {
        let id = context.config().identifier.clone();
        context.config_mut().identifier = format!(
            "{id}.profile{}",
            &updates::hash(profile.to_string_lossy().as_bytes())[..16]
        );
    }
    let app = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(move |app, args, _| {
            let _ = create_window(app, single.clone());
            single.files.lock().unwrap().extend(
                args.iter()
                    .skip(1)
                    .map(PathBuf::from)
                    .filter(|p| p.is_absolute() && storage::supported(p)),
            );
            single.flush_files();
            single.show();
        }))
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            desktop_save_download,
            desktop_copy_image,
            desktop_paste_image,
            desktop_text_action,
            desktop_library,
            desktop_bootstrap,
            desktop_migration_complete,
            desktop_session,
            desktop_sessions,
            desktop_recovered,
            desktop_window_state,
            desktop_window,
            desktop_reply,
            desktop_ready,
            desktop_language,
            desktop_update_state,
            desktop_update,
            desktop_quit
        ])
        .setup(move |app| {
            setup.app.set(app.handle().clone()).ok();
            create_window(app.handle(), setup.clone()).map_err(std::io::Error::other)?;
            let saver = setup.clone();
            let mut changes = saver.save_changes.subscribe();
            tauri::async_runtime::spawn(async move {
                while changes.changed().await.is_ok() {
                    loop {
                        match tokio::time::timeout(Duration::from_millis(250), changes.changed())
                            .await
                        {
                            Ok(Ok(())) => continue,
                            Ok(Err(_)) => return,
                            Err(_) => break,
                        }
                    }
                    let state = saver.clone();
                    if let Ok(Err(error)) =
                        tauri::async_runtime::spawn_blocking(move || state.save()).await
                    {
                        eprintln!("Save window settings: {error}");
                    }
                }
            });
            let rpc = setup.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_rpc(rpc).await {
                    eprintln!("MCP transport failed: {error}");
                }
            });
            let background = setup.clone();
            tauri::async_runtime::spawn(async move {
                while !background.ready.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
                loop {
                    let _ = check_updates(background.clone()).await;
                    tokio::time::sleep(Duration::from_secs(30 * 60)).await;
                }
            });
            Ok(())
        })
        .build(context)
        .expect("Build Pixprite native runtime");
    app.run(move |app, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if !state.allow_exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                if cfg!(target_os = "macos")
                    && code.is_none()
                    && app.get_webview_window("main").is_none()
                {
                    return;
                }
                let quit = state.clone();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = if quit.ready.load(Ordering::SeqCst) {
                        quit.request(Request {
                            method: "prepare_close".into(),
                            params: Value::Null,
                        })
                        .await
                        .map(|_| ())
                    } else {
                        Ok(())
                    };
                    match result.and_then(|_| quit.save()) {
                        Ok(()) => {
                            quit.allow_exit.store(true, Ordering::SeqCst);
                            handle.exit(0);
                        }
                        Err(error) => quit.notice(error),
                    }
                });
            }
        }
        tauri::RunEvent::Exit => state.cleanup(),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let _ = create_window(app, state.clone());
            state.files.lock().unwrap().extend(
                urls.into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| storage::supported(path)),
            );
            state.flush_files();
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            let _ = create_window(app, state.clone());
        }
        _ => {}
    });
}
