import { signal } from '@preact/signals-react';

export const IDLE_FOLLOW_MS = 10_000;
export const agentActivity = signal<{ source: string; documentId?: string; label: string; following: boolean } | null>(null);
let lastInput = performance.now();
let focused = typeof document !== 'undefined' && document.hasFocus();
let pending: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let clearHighlight = (_following: boolean) => {};

export function userActivity() {
  lastInput = performance.now();
  clearHighlight(!!agentActivity.peek()?.following);
  if (agentActivity.peek()) agentActivity.value = { ...agentActivity.peek()!, following: false };
  if (pending) { clearTimeout(timer); timer = setTimeout(follow, IDLE_FOLLOW_MS); }
}
function follow() {
  clearTimeout(timer);
  if (!pending) return;
  const remaining = IDLE_FOLLOW_MS - (performance.now() - lastInput);
  if (remaining > 0) { timer = setTimeout(follow, remaining); return; }
  if (!focused || document.hidden || !document.hasFocus()) return;
  pending();
  if (agentActivity.peek()) agentActivity.value = { ...agentActivity.peek()!, following: true };
}
export function reportActivity(source: string, documentId: string | undefined, label: string, reveal?: () => void) {
  agentActivity.value = { source, documentId, label, following: false };
  pending = reveal;
  follow();
}
export function installAgentActivity(clear: (following: boolean) => void) {
  clearHighlight = clear;
  const input = (event: Event) => { if (event.isTrusted) userActivity(); };
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input']) window.addEventListener(name, input, { capture: true, passive: true });
  window.addEventListener('blur', () => { focused = false; userActivity(); });
  window.addEventListener('focus', () => { focused = true; userActivity(); follow(); });
  window.pixpriteDesktop?.onWindowState(window => { focused = window.focused; if (!focused) userActivity(); else follow(); });
  focused = document.hasFocus();
}
