//! Explicit, interactive screen sampling. Only the trusted local editor may start/cancel it.
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::{State, WebviewWindow};
use tokio_util::sync::CancellationToken;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Clone, Default)]
pub struct ScreenColorState(Arc<Mutex<PickerState>>);

#[derive(Default)]
struct PickerState {
    active: Option<(String, CancellationToken)>,
    cancelled: VecDeque<String>,
}

struct Session {
    state: ScreenColorState,
    id: String,
}
impl Drop for Session {
    fn drop(&mut self) {
        let mut active = self.state.0.lock().unwrap();
        if active.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
            active.active = None;
        }
    }
}

impl ScreenColorState {
    fn begin(&self, id: String) -> Result<(Session, CancellationToken), String> {
        if id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("Invalid screen picker request ID".into());
        }
        let mut active = self.0.lock().unwrap();
        if active.active.is_some() {
            return Err("A screen color selection is already active".into());
        }
        let cancel = CancellationToken::new();
        if let Some(at) = active.cancelled.iter().position(|value| value == &id) {
            active.cancelled.remove(at);
            cancel.cancel();
        }
        active.active = Some((id.clone(), cancel.clone()));
        Ok((
            Session {
                state: self.clone(),
                id,
            },
            cancel,
        ))
    }

    fn cancel(&self, request_id: &str) {
        let mut state = self.0.lock().unwrap();
        if let Some((id, cancel)) = state.active.as_ref() {
            if id == request_id {
                cancel.cancel();
                return;
            }
        }
        // IPC handlers may start out of order when a popup closes immediately.
        if !request_id.is_empty()
            && request_id.len() <= 64
            && !state.cancelled.iter().any(|id| id == request_id)
        {
            state.cancelled.push_back(request_id.to_owned());
            if state.cancelled.len() > 64 {
                state.cancelled.pop_front();
            }
        }
    }
}

pub(super) fn rgb_hex(rgb: [f64; 3]) -> Result<String, String> {
    if rgb
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    {
        return Err("The system returned an invalid screen color".into());
    }
    let [r, g, b] = rgb.map(|v| (v * 255.0).round() as u8);
    Ok(format!("#{r:02x}{g:02x}{b:02x}"))
}

#[tauri::command]
pub async fn desktop_pick_screen_color(
    window: WebviewWindow,
    state: State<'_, ScreenColorState>,
    request_id: String,
) -> Result<Option<String>, String> {
    crate::trusted(&window)?;
    let (_session, cancel) = state.begin(request_id)?;
    #[cfg(target_os = "macos")]
    {
        macos::pick(window, cancel).await
    }
    #[cfg(target_os = "linux")]
    {
        let _ = window;
        linux::pick(cancel).await
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window;
        tauri::async_runtime::spawn_blocking(move || windows::pick(cancel))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (window, cancel);
        Err("Screen color selection is unsupported on this platform".into())
    }
}

#[tauri::command]
pub fn desktop_cancel_screen_color(
    window: WebviewWindow,
    state: State<'_, ScreenColorState>,
    request_id: String,
) -> Result<(), String> {
    crate::trusted(&window)?;
    state.cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screen_color_is_srgb_bytes_and_rejects_invalid_portal_values() {
        assert_eq!(rgb_hex([0.0, 0.5, 1.0]).unwrap(), "#0080ff");
        for rgb in [
            [f64::NAN, 0.0, 0.0],
            [f64::INFINITY, 0.0, 0.0],
            [-0.1, 0.0, 0.0],
            [1.1, 0.0, 0.0],
        ] {
            assert!(rgb_hex(rgb).is_err());
        }
    }
    #[test]
    fn overlapping_pickers_are_rejected_and_cancel_only_matches_its_request() {
        let state = ScreenColorState::default();
        assert!(state.begin("bad/id".into()).is_err());
        let (session, cancel) = state.begin("first".into()).unwrap();
        assert!(state.begin("second".into()).is_err());
        state.cancel("unrelated");
        assert!(!cancel.is_cancelled());
        state.cancel("first");
        assert!(cancel.is_cancelled());
        // A cancelled OS session still owns the slot until its UI/resources are released.
        assert!(state.begin("second".into()).is_err());
        drop(session);
        let (_next, cancel) = state.begin("second".into()).unwrap();
        state.cancel("first");
        assert!(!cancel.is_cancelled());
    }
    #[test]
    fn cancellation_can_arrive_before_the_pick_command_starts() {
        let state = ScreenColorState::default();
        state.cancel("pending");
        let (_session, cancel) = state.begin("pending".into()).unwrap();
        assert!(cancel.is_cancelled());
    }
}
