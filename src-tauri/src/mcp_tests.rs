use super::*;
use crate::{library, updates::UpdateState};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

fn fixture(directory: &Path, options: &Options) -> Arc<Native> {
    let profile = directory.join("profile");
    fs::create_dir_all(&profile).unwrap();
    Arc::new(Native {
        app: OnceLock::new(),
        profile: profile.clone(),
        library: Mutex::new(library::Library::new(directory.join("library")).unwrap()),
        config: Mutex::new(json!({})),
        config_write: Mutex::new(()),
        save_changes: tokio::sync::watch::channel(()).0,
        update: Mutex::new(UpdateState::default()),
        pending: Mutex::new(HashMap::new()),
        files: Mutex::new(Vec::new()),
        ready: AtomicBool::new(false),
        open: AtomicBool::new(true),
        closing: AtomicBool::new(false),
        allow_close: AtomicBool::new(false),
        allow_exit: AtomicBool::new(false),
        checking: AtomicBool::new(false),
        connection: Mutex::new(None),
        connection_file: directory.join("connection.json"),
        mcp: tokio::sync::Mutex::new(Runtime::new(options)),
    })
}
fn run(test: impl std::future::Future<Output = ()>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(test);
}

#[test]
fn connection_discovery_rejects_remote_addresses_and_accepts_standard_ports() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("connection.json");
    let value = json!({"url":"http://127.0.0.1:1234/rpc","mcpUrl":"http://127.0.0.1:1234/mcp","token":"a".repeat(64),"pid":1,"port":1234,"instance":"test","version":"1"});
    storage::atomic_json(&path, &value).unwrap();
    assert!(Connection::read(&path).is_some());
    let mut standard = value.clone();
    for field in ["url", "mcpUrl"] {
        standard[field] = json!(value[field].as_str().unwrap().replace(":1234", ":80"));
    }
    standard["port"] = json!(80);
    storage::atomic_json(&path, &standard).unwrap();
    assert!(Connection::read(&path).is_some());
    for field in ["url", "mcpUrl"] {
        let mut invalid = value.clone();
        invalid[field] = json!("http://example.com/steal");
        storage::atomic_json(&path, &invalid).unwrap();
        assert!(Connection::read(&path).is_none());
    }
}
#[test]
fn embedded_schemas_validate_native_tool_calls_without_window_routing() {
    let tool = |name: &str| {
        catalog()
            .iter()
            .find(|entry| entry.tool.name == name)
            .unwrap()
    };
    assert!(tool("pixprite_create")
        .validator
        .is_valid(&json!({"width":8,"height":8})));
    assert!(!tool("pixprite_create")
        .validator
        .is_valid(&json!({"width":0,"height":8})));
    assert!(!tool("pixprite_edit")
        .validator
        .is_valid(&json!({"operations":[{"method":"sprite.layers.remove","args":[-1]}]})));
    assert!(tool("pixprite_edit").validator.is_valid(
        &json!({"operations":[{"method":"sprite.layers.add","args":[{"name":"Layer"}]}]})
    ));
    assert!(tool("pixprite_pixels_batch").validator.is_valid(&json!({"documentId":"doc", "expectedRevision":2,"operations":[{"action":"fill","frame":59,"layer":5,"fill":"#ff0000"}]})));
    assert!(tool("pixprite_playback")
        .validator
        .is_valid(&json!({"action":"stop"})));
    assert!(!tool("pixprite_playback")
        .validator
        .is_valid(&json!({"action":"toggle"})));
    assert!(!catalog()
        .iter()
        .any(|entry| entry.tool.name == "pixprite_windows"));
}

#[test]
fn image_tool_results_preserve_provenance_without_duplicating_image_data() {
    let result =
        tool_result(json!({"image":"png-data","documentId":"sprite","frame":59,"revision":42}));
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value["content"][0]["type"], "image");
    assert_eq!(value["content"][0]["data"], "png-data");
    assert_eq!(value["structuredContent"]["revision"], 42);
    assert_eq!(value["structuredContent"]["documentId"], "sprite");
    assert!(value["structuredContent"].get("image").is_none());
    let text: Value = serde_json::from_str(value["content"][1]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text["frame"], 59);
}
#[test]
fn embedded_server_is_off_by_default_and_stops_without_an_idle_delay() {
    run(async {
        let directory = tempfile::tempdir().unwrap();
        let state = fixture(directory.path(), &Options::default());
        assert_eq!(synchronize(state.clone()).await["running"], false);
        assert!(!state.connection_file.exists());
        state.config.lock().unwrap()["mcpEnabled"] = json!(true);
        state.config.lock().unwrap()["mcpPort"] = json!(0);
        assert_eq!(synchronize(state.clone()).await["running"], true);
        let connection = Connection::read(&state.connection_file).unwrap();
        assert_eq!(connection.pid, std::process::id());
        let client = reqwest::Client::new();
        let response = client
            .post(&connection.url)
            .json(&json!({"method":"documents"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let response = client
            .post(&connection.url)
            .bearer_auth(&connection.token)
            .json(&json!({"method":"documents"}))
            .send()
            .await
            .unwrap();
        assert!(response.text().await.unwrap().contains("still starting"));
        state.config.lock().unwrap()["mcpEnabled"] = json!(false);
        assert_eq!(synchronize(state.clone()).await["running"], false);
        assert!(!state.connection_file.exists());
        assert!(reqwest::Client::new()
            .post(&connection.url)
            .send()
            .await
            .is_err());
    });
}
#[test]
fn launch_flags_do_not_change_preferences_and_closing_the_editor_stops_mcp() {
    run(async {
        let directory = tempfile::tempdir().unwrap();
        let state = fixture(
            directory.path(),
            &Options {
                mcp: true,
                port: Some(0),
                ..Default::default()
            },
        );
        state.config.lock().unwrap()["mcpEnabled"] = json!(false);
        let info = synchronize(state.clone()).await;
        assert_eq!(info["running"], true);
        assert_eq!(info["enabled"], false);
        assert_eq!(info["forced"], true);
        assert_eq!(state.config.lock().unwrap()["mcpEnabled"], false);
        assert!(state.config.lock().unwrap().get("mcpPort").is_none());
        state.open.store(false, Ordering::SeqCst);
        assert_eq!(synchronize(state.clone()).await["running"], false);
        assert!(!state.connection_file.exists());
    });
}
#[test]
fn an_occupied_port_is_reported_and_startup_can_be_retried() {
    run(async {
        let directory = tempfile::tempdir().unwrap();
        let state = fixture(directory.path(), &Options::default());
        let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = occupied.local_addr().unwrap().port();
        *state.config.lock().unwrap() = json!({"mcpEnabled":true,"mcpPort":port});
        let info = synchronize(state.clone()).await;
        assert_eq!(info["running"], false);
        assert!(info["error"].as_str().unwrap().contains("bind"));
        drop(occupied);
        assert_eq!(synchronize(state.clone()).await["activePort"], port);
        state.open.store(false, Ordering::SeqCst);
        synchronize(state).await;
    });
}

#[test]
fn explicit_disable_overrides_saved_preferences_and_can_stop_a_running_server() {
    run(async {
        let directory = tempfile::tempdir().unwrap();
        let state = fixture(
            directory.path(),
            &Options {
                no_mcp: true,
                ..Default::default()
            },
        );
        *state.config.lock().unwrap() = json!({"mcpEnabled":true,"mcpPort":0});
        let info = synchronize(state.clone()).await;
        assert_eq!(info["running"], false);
        assert_eq!(info["blocked"], true);
        assert_eq!(info["enabled"], true);
        assert!(!state.connection_file.exists());
        assert!(!state.profile.join("mcp-token.json").exists());
        state.mcp.lock().await.apply_cli(&Options {
            mcp: true,
            port: Some(0),
            ..Default::default()
        });
        assert_eq!(synchronize(state.clone()).await["running"], true);
        state.mcp.lock().await.apply_cli(&Options {
            no_mcp: true,
            ..Default::default()
        });
        let info = synchronize(state.clone()).await;
        assert_eq!(info["running"], false);
        assert_eq!(info["blocked"], true);
        assert_eq!(info["forced"], false);
        assert_eq!(
            *state.config.lock().unwrap(),
            json!({"mcpEnabled":true,"mcpPort":0})
        );
        assert!(!state.connection_file.exists());
    });
}
