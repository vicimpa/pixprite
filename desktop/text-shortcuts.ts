/** macOS normally routes text shortcuts through an Edit menu. Keep the responder chain without a menu. */
export function installTextShortcuts(token: string, invoke: (action: string) => Promise<unknown>) {
  if (!/Mac/.test(navigator.platform)) return;
  const top = window.top === window.self;
  // Capture before extension code runs. The nonce stays inside this initialization closure.
  const post = window.top!.postMessage.bind(window.top);
  const actions: Record<string, string> = { KeyA: 'selectAll', KeyC: 'copy', KeyX: 'cut', KeyV: 'paste', KeyZ: 'undo', KeyY: 'redo' };
  if (top) window.addEventListener('message', event => {
    const focused = document.activeElement;
    if (event.data?.type === 'pixprite:text-shortcut' && event.data.token === token && Object.values(actions).includes(event.data.action)
      && focused instanceof HTMLIFrameElement && focused.contentWindow === event.source) void invoke(event.data.action).catch(console.error);
  });
  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    if (!event.isTrusted || !event.metaKey || event.ctrlKey || event.altKey || !(target?.matches('input,textarea') || target?.isContentEditable)) return;
    let action = actions[event.code]; if (!action) return;
    if (event.code === 'KeyZ' && event.shiftKey) action = 'redo';
    event.preventDefault(); event.stopImmediatePropagation();
    if (top) void invoke(action).catch(console.error);
    else post({ type: 'pixprite:text-shortcut', token, action }, '*');
  }, true);
}
