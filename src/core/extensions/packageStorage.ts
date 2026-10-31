/** WebKit can reject Blob values in IndexedDB. Keep package bytes portable; runtime readers still use Blob. */
type StoredFiles = { files: Record<string, Blob | { bytes: ArrayBuffer; type: string }> };
export async function packFiles<T extends StoredFiles>(value: T) {
  const files = Object.fromEntries(await Promise.all(Object.entries(value.files).map(async ([path, file]) =>
    [path, file instanceof Blob ? { bytes: await file.arrayBuffer(), type: file.type } : file] as const)));
  return { ...value, files };
}
export function unpackFiles<T extends StoredFiles>(value: T) {
  return { ...value, files: Object.fromEntries(Object.entries(value.files).map(([path, file]) =>
    [path, file instanceof Blob ? file : new Blob([file.bytes], { type: file.type })])) };
}
