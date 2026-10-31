import { installTextShortcuts } from './text-shortcuts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { importStorage, type Migration } from './migration';
import type { DesktopBridge, AutomationRequest, DesktopFile, WindowState } from './protocol';
import type { UpdateState } from './update-types';

installTextShortcuts('__PIXPRITE_SHORTCUT_TOKEN__', action => invoke('desktop_text_action', { action }));
const encode = (bytes: Uint8Array) => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); };
if (window.top === window.self) {
  // WebView console output is not inherited by the native process on every platform.
  const reportError = (error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    void invoke('desktop_frontend_error', { message: message.slice(0, 4096) }).catch(() => {});
  };
  window.addEventListener('error', event => reportError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => reportError(event.reason));
  let onRequest: ((request: AutomationRequest) => Promise<unknown>) | undefined;
  let onFiles: ((files: DesktopFile[]) => Promise<void>) | undefined;
  const states = new Set<(state: WindowState) => void>(), updates = new Set<(state: UpdateState) => void>();
  const bridge: DesktopBridge & { startup: Promise<void> } = {
    library(request) { return invoke('desktop_library', request); },
    async saveDownload(name, blob) { await invoke('desktop_save_download', { name, data: encode(new Uint8Array(await blob.arrayBuffer())) }); },
    copyImage(bitmap) { return invoke('desktop_copy_image', { bitmap: { ...bitmap, data: encode(new Uint8Array(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.byteLength)) } }); },
    async pasteImage() { const image = await invoke<{ w: number; h: number; data: string } | null>('desktop_paste_image'); return image && { ...image, data: new Uint32Array(Uint8Array.from(atob(image.data), c => c.charCodeAt(0)).buffer) }; },
    runtime: 'tauri', windowId: 'main', platform: '', recoveryWindows: [],
    recoveredWindows(ids) { void invoke('desktop_recovered', { ids }); },
    reportSession(session) { return invoke('desktop_session', { session }); },
    readSessions() { return invoke('desktop_sessions'); },
    windowState() { return invoke('desktop_window_state'); },
    onWindowState(handler) { states.add(handler); return () => { states.delete(handler); }; },
    controlWindow(action) { return invoke('desktop_window', { action }); },
    onRequest(handler) { onRequest = handler; }, onFiles(handler) { onFiles = handler; },
    ready() { void invoke('desktop_ready'); }, getUpdate() { return invoke('desktop_update_state'); },
    onUpdate(handler) { updates.add(handler); return () => { updates.delete(handler); }; },
    update(action) { return invoke('desktop_update', { action }); },
    setLanguage(language) { void invoke('desktop_language', { language }); },
    startup: Promise.resolve(),
  };
  window.pixpriteDesktop = bridge;
  bridge.startup = (async () => {
    await Promise.all([
      listen<{ id: string; request: AutomationRequest }>('pixprite-request', async ({ payload: { id, request } }) => {
        try { if (!onRequest) throw new Error('Editor is still starting'); await invoke('desktop_reply', { id, result: await onRequest(request) }); }
        catch (error) { await invoke('desktop_reply', { id, error: error instanceof Error ? error.message : String(error) }); }
      }),
      listen<DesktopFile[]>('pixprite-files', ({ payload }) => { void onFiles?.(payload).catch(console.error); }),
      listen<WindowState>('pixprite-window', ({ payload }) => states.forEach(handler => handler(payload))),
      listen<UpdateState>('pixprite-update', ({ payload }) => updates.forEach(handler => handler(payload))),
      listen<string>('pixprite-notice', ({ payload }) => window.dispatchEvent(new CustomEvent('pixprite:notice', { detail: payload }))),
    ]);
    const value = await invoke<{ platform: string; recovery: string[]; migration?: Migration }>('desktop_bootstrap');
    bridge.platform = value.platform; bridge.recoveryWindows = value.recovery;
    if (value.migration) {
      const library = await invoke<{ migrated: boolean }>('desktop_library', new TextEncoder().encode(JSON.stringify({ action: 'info' })));
      if (library.migrated) throw new Error('The native library already exists. Open .pixprite files to import additional projects.');
      await importStorage(value.migration); await invoke('desktop_migration_complete', { id: value.migration.id });
    }
  })();
  bridge.startup.catch(error => { console.error('Native startup failed', error); });
  window.addEventListener('keydown', event => {
    const primary = bridge.platform === 'darwin' ? event.metaKey : event.ctrlKey;
    if (primary && !event.altKey && event.code === 'KeyQ') { event.preventDefault(); void invoke('desktop_quit'); }
    if (bridge.platform === 'darwin' && event.metaKey && event.code === 'KeyM') { event.preventDefault(); void bridge.controlWindow('minimize'); }
  }, true);
}
