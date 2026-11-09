use super::rgb_hex;
use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSColor, NSColorSampler, NSColorSpace, NSEvent, NSEventModifierFlags,
    NSEventType,
};
use objc2_foundation::{NSPoint, NSString};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::WebviewWindow;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

pub async fn pick(
    window: WebviewWindow,
    cancel: CancellationToken,
) -> Result<Option<String>, String> {
    let (tx, mut rx) = oneshot::channel();
    let start_cancel = cancel.clone();
    let sampling = Arc::new(AtomicBool::new(false));
    let active = sampling.clone();
    window
        .run_on_main_thread(move || {
            if start_cancel.is_cancelled() {
                let _ = tx.send(Ok(None));
                return;
            }
            let tx = Mutex::new(Some(tx));
            let completed = active.clone();
            let handler = RcBlock::new(move |color: *mut NSColor| {
                completed.store(false, Ordering::Release);
                // AppKit owns the callback color; convert it to sRGB while it is alive.
                let result = unsafe { color.as_ref() }
                    .map(|color| {
                        let color = color
                            .colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())
                            .ok_or("Cannot convert the selected color to sRGB")?;
                        rgb_hex([
                            color.redComponent(),
                            color.greenComponent(),
                            color.blueComponent(),
                        ])
                    })
                    .transpose();
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
            });
            // NSColorSampler retains itself and copies the block until selection or Escape.
            active.store(true, Ordering::Release);
            unsafe {
                NSColorSampler::new().showSamplerWithSelectionHandler(&handler);
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::select! {
        result = &mut rx => result.map_err(|e| e.to_string())?,
        _ = cancel.cancelled() => {
            // Post Escape only to this application's sampler, never to another application.
            window.run_on_main_thread(move || {
                if !sampling.load(Ordering::Acquire) { return; }
                let app = NSApplication::sharedApplication(MainThreadMarker::new().expect("Main thread"));
                let escape = NSString::from_str("\u{1b}");
                if let Some(event) = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                    NSEventType::KeyDown, NSPoint::new(0.0, 0.0), NSEventModifierFlags::empty(), 0.0, 0, None, &escape, &escape, false, 53,
                ) { app.postEvent_atStart(&event, true); }
            }).map_err(|e| e.to_string())?;
            // Keep the session slot until AppKit has dismissed its sampling UI.
            let _ = rx.await;
            Ok(None)
        }
    }
}
