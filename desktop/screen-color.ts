type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** Keep the native request and its cancellation paired, including immediate popup disposal. */
export async function pickScreenColor(invoke: Invoke, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const requestId = crypto.randomUUID();
  const abort = () => { void invoke('desktop_cancel_screen_color', { requestId }).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const color = await invoke<string | null>('desktop_pick_screen_color', { requestId });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return color;
  } finally { signal?.removeEventListener('abort', abort); }
}
