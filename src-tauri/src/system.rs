//! Native save dialogs and clipboard, kept behind the local main-window bridge.
use crate::trusted;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize)]
pub struct Bitmap {
    w: u32,
    h: u32,
    data: String,
}
#[tauri::command]
pub async fn desktop_copy_image(window: WebviewWindow, bitmap: Bitmap) -> Result<(), String> {
    trusted(&window)?;
    if bitmap.w == 0 || bitmap.h == 0 || bitmap.w > 4096 || bitmap.h > 4096 {
        return Err("Invalid clipboard dimensions".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bitmap.data)
        .map_err(|e| e.to_string())?;
    if bytes.len() != bitmap.w as usize * bitmap.h as usize * 4 {
        return Err("Invalid clipboard pixels".into());
    }
    window
        .clipboard()
        .write_image(&tauri::image::Image::new_owned(bytes, bitmap.w, bitmap.h))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn desktop_paste_image(window: WebviewWindow) -> Result<Option<Bitmap>, String> {
    trusted(&window)?;
    match window.clipboard().read_image() {
        Ok(image) if image.width() <= 4096 && image.height() <= 4096 => Ok(Some(Bitmap {
            w: image.width(),
            h: image.height(),
            data: base64::engine::general_purpose::STANDARD.encode(image.rgba()),
        })),
        _ => Ok(None),
    }
}
#[tauri::command]
pub async fn desktop_save_download(
    window: WebviewWindow,
    name: String,
    data: String,
) -> Result<(), String> {
    trusted(&window)?;
    if name.is_empty()
        || name.len() > 255
        || name.chars().any(|c| c.is_control() || "/\\:".contains(c))
        || name == "."
        || name == ".."
        || data.len() > 360 * 1024 * 1024
    {
        return Err("Invalid export name or size".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("Export exceeds 256 MiB".into());
    }
    let mut dialog = window
        .dialog()
        .file()
        .set_file_name(&name)
        .set_parent(&window);
    if let Some(directory) = dirs::download_dir() {
        dialog = dialog.set_directory(directory);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    if let Some(path) = rx.await.map_err(|e| e.to_string())? {
        crate::storage::atomic_bytes(&path.into_path().map_err(|e| e.to_string())?, &bytes)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn desktop_text_action(window: WebviewWindow, action: String) -> Result<(), String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        use objc2::{sel, MainThreadMarker};
        use objc2_app_kit::NSApplication;
        let selector = match action.as_str() {
            "copy" => sel!(copy:),
            "cut" => sel!(cut:),
            "paste" => sel!(paste:),
            "selectAll" => sel!(selectAll:),
            "undo" => sel!(undo:),
            "redo" => sel!(redo:),
            _ => return Err("Unknown text action".into()),
        };
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let app =
                    NSApplication::sharedApplication(MainThreadMarker::new().expect("Main thread"));
                // Standard responder-chain actions also reach text fields in sandboxed WebView frames.
                unsafe {
                    app.sendAction_to_from(selector, None, None);
                }
                let _ = tx.send(());
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = action;
    }
    Ok(())
}
