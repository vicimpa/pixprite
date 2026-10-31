//! WKWebView prefers 60 fps even on ProMotion. Request the display cadence when its feature API exists.
//! This guarded WebKit SPI is isolated here; unsupported runtimes retain their normal defaults.
use std::sync::atomic::{AtomicU8, Ordering};
static POLICY: AtomicU8 = AtomicU8::new(0);
pub fn policy() -> &'static str {
    match POLICY.load(Ordering::Relaxed) {
        1 => "display",
        2 => "prefer-60",
        _ => "platform-default",
    }
}
pub fn configure(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let prefer_60 = std::env::var("PIXPRITE_WEBVIEW_FPS").as_deref() == Ok("60");
        window.with_webview(move |webview| {
            use objc2::{msg_send, rc::Retained, runtime::{AnyObject, Bool}, sel, ClassType};
            use objc2_foundation::{NSArray, NSString};
            use objc2_web_kit::{WKPreferences, WKWebView};
            // The runtime owns the view, and Tauri executes this closure on its main thread.
            unsafe {
                let view: &WKWebView = &*webview.inner().cast();
                let preferences = view.configuration().preferences();
                let class = WKPreferences::class();
                let has_features: Bool = msg_send![class, respondsToSelector: sel!(_features)];
                let has_setter: Bool = msg_send![&preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
                if !has_features.as_bool() || !has_setter.as_bool() { return; }
                let features: Retained<NSArray<AnyObject>> = msg_send![class, _features];
                for feature in features.iter() {
                    let has_key: Bool = msg_send![&feature, respondsToSelector: sel!(key)];
                    if !has_key.as_bool() { continue; }
                    let key: Retained<NSString> = msg_send![&feature, key];
                    if key.to_string() == "PreferPageRenderingUpdatesNear60FPSEnabled" {
                        let _: () = msg_send![&preferences, _setEnabled: Bool::new(prefer_60), forFeature: &*feature];
                        POLICY.store(if prefer_60 {2} else {1},Ordering::Relaxed);
                        break;
                    }
                }
            }
        })?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
    Ok(())
}
