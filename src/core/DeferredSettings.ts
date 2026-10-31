/** Coalesce preference writes during interaction; closing the page or native app flushes the latest values. */
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function flushSettings() {
  clearTimeout(timer); timer = undefined;
  for (const [key, value] of pending) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Settings remain usable in memory. */ }
  }
  pending.clear();
}
export function deferSetting(key: string, value: unknown) {
  pending.set(key, value);
  clearTimeout(timer); timer = setTimeout(flushSettings, 250);
}
addEventListener('pagehide', flushSettings);
