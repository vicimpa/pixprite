/** Serialized payload bytes, not the browser's implementation-dependent IndexedDB overhead. */
export const serializedBytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).byteLength;

export function isQuotaError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function persistentStorage(manager = globalThis.navigator?.storage): Promise<boolean | null> {
  try { return manager?.persisted ? await manager.persisted() : null; } catch { return null; }
}

export async function requestPersistentStorage(manager = globalThis.navigator?.storage): Promise<boolean | null> {
  try { return manager?.persist ? await manager.persist() : null; } catch { return null; }
}

export const storageNearlyFull = (usage: { used: number; quota: number } | null) =>
  !!usage && usage.quota > 0 && usage.used / usage.quota >= 0.85;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
