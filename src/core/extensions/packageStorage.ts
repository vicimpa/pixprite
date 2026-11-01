/** WebKit can reject Blob values in IndexedDB. Keep package bytes portable; runtime readers still use Blob. */
type StoredFiles = { files: Record<string, Blob | { bytes: ArrayBuffer; type: string }>; previous?: { files: StoredFiles['files'] } };
const pack = async (files: StoredFiles['files']) => Object.fromEntries(await Promise.all(Object.entries(files).map(async ([path, file]) =>
  [path, file instanceof Blob ? { bytes: await file.arrayBuffer(), type: file.type } : file] as const)));
const unpack = (files: StoredFiles['files']) => Object.fromEntries(Object.entries(files).map(([path, file]) =>
  [path, file instanceof Blob ? file : new Blob([file.bytes], { type: file.type })]));
export async function packFiles<T extends StoredFiles>(value: T) {
  return { ...value, files: await pack(value.files), ...(value.previous ? { previous: { ...value.previous, files: await pack(value.previous.files) } } : {}) };
}
export function unpackFiles<T extends StoredFiles>(value: T) {
  return { ...value, files: unpack(value.files), ...(value.previous ? { previous: { ...value.previous, files: unpack(value.previous.files) } } : {}) };
}
