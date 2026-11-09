use std::{
    mem::zeroed,
    ptr::{null, null_mut},
};
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::*,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        Input::KeyboardAndMouse::SetFocus,
        WindowsAndMessaging::*,
    },
};

struct DpiContext(DPI_AWARENESS_CONTEXT);
impl Drop for DpiContext {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}

struct Capture {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    result: Option<Result<Option<String>, String>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_null() {
                SelectObject(self.dc, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.dc.is_null() {
                DeleteDC(self.dc);
            }
        }
    }
}

unsafe extern "system" fn procedure(window: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(l as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    let capture = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut Capture;
    if !capture.is_null() {
        let capture = &mut *capture;
        match message {
            WM_PAINT => {
                let mut paint: PAINTSTRUCT = zeroed();
                let dc = BeginPaint(window, &mut paint);
                let rect = paint.rcPaint;
                BitBlt(
                    dc,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    capture.dc,
                    rect.left,
                    rect.top,
                    SRCCOPY,
                );
                EndPaint(window, &paint);
                return 0;
            }
            WM_ERASEBKGND => return 1,
            WM_LBUTTONDOWN => {
                // The overlay contains the unchanged desktop capture; no click reaches other apps.
                let mut point: POINT = zeroed();
                if GetCursorPos(&mut point) == 0 || ScreenToClient(window, &mut point) == 0 {
                    capture.result = Some(Err("Cannot read the screen pointer position".into()));
                    return 0;
                }
                let color = GetPixel(capture.dc, point.x, point.y);
                capture.result = Some(if color == CLR_INVALID {
                    Err("Cannot read the selected screen pixel".into())
                } else {
                    Ok(Some(format!(
                        "#{:02x}{:02x}{:02x}",
                        color & 255,
                        (color >> 8) & 255,
                        (color >> 16) & 255
                    )))
                });
                return 0;
            }
            WM_RBUTTONDOWN | WM_CLOSE => {
                capture.result = Some(Ok(None));
                return 0;
            }
            WM_KEYDOWN if w == 27 => {
                capture.result = Some(Ok(None));
                return 0;
            }
            WM_KILLFOCUS => {
                capture.result = Some(Ok(None));
                return 0;
            }
            _ => {}
        }
    }
    DefWindowProcW(window, message, w, l)
}

pub fn pick(cancel: CancellationToken) -> Result<Option<String>, String> {
    unsafe {
        if cancel.is_cancelled() {
            return Ok(None);
        }
        // This worker may run on a different-DPI display than the editor window.
        let previous_dpi = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if previous_dpi.is_null() {
            return Err("Cannot set screen sampling DPI awareness".into());
        }
        let _dpi = DpiContext(previous_dpi);
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width <= 0 || height <= 0 || i64::from(width) * i64::from(height) > 128 * 1024 * 1024 {
            return Err("Invalid desktop capture dimensions".into());
        }
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("Cannot access the desktop display".into());
        }
        let mut capture = Capture {
            dc: CreateCompatibleDC(screen),
            bitmap: CreateCompatibleBitmap(screen, width, height),
            previous: null_mut(),
            result: None,
        };
        if capture.dc.is_null() || capture.bitmap.is_null() {
            ReleaseDC(null_mut(), screen);
            return Err("Cannot allocate the desktop capture".into());
        }
        capture.previous = SelectObject(capture.dc, capture.bitmap);
        if capture.previous.is_null() || capture.previous as isize == -1 {
            capture.previous = null_mut();
            ReleaseDC(null_mut(), screen);
            return Err("Cannot initialize the desktop capture".into());
        }
        let copied = BitBlt(
            capture.dc,
            0,
            0,
            width,
            height,
            screen,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        );
        ReleaseDC(null_mut(), screen);
        if copied == 0 {
            return Err("Cannot capture the desktop".into());
        }
        let class: Vec<u16> = "PixpriteScreenColor\0".encode_utf16().collect();
        let instance = GetModuleHandleW(null());
        let mut spec: WNDCLASSW = zeroed();
        spec.lpfnWndProc = Some(procedure);
        spec.hInstance = instance;
        spec.lpszClassName = class.as_ptr();
        spec.hCursor = LoadCursorW(null_mut(), IDC_CROSS);
        if RegisterClassW(&spec) == 0 {
            return Err("Cannot register the screen color picker".into());
        }
        // A short-lived native overlay, not an additional WebView/editor window.
        let window = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            class.as_ptr(),
            class.as_ptr(),
            WS_POPUP,
            x,
            y,
            width,
            height,
            null_mut(),
            null_mut(),
            instance,
            (&mut capture as *mut Capture).cast(),
        );
        if window.is_null() {
            UnregisterClassW(class.as_ptr(), instance);
            return Err("Cannot open the screen color picker".into());
        }
        ShowWindow(window, SW_SHOW);
        SetForegroundWindow(window);
        SetFocus(window);
        let mut message: MSG = zeroed();
        while capture.result.is_none() && !cancel.is_cancelled() {
            while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                if message.message == WM_QUIT {
                    capture.result = Some(Ok(None));
                    break;
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
                if capture.result.is_some() {
                    break;
                }
            }
            if capture.result.is_none() && !cancel.is_cancelled() {
                MsgWaitForMultipleObjectsEx(0, null(), 20, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            }
        }
        // Stop callbacks before dropping the GDI capture they reference.
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        DestroyWindow(window);
        UnregisterClassW(class.as_ptr(), instance);
        if cancel.is_cancelled() {
            Ok(None)
        } else {
            capture.result.take().unwrap_or(Ok(None))
        }
    }
}
