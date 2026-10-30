/** Internal IndexedDB manifests. Public .pixprite files remain self-contained. */
import { runTask } from './BackgroundTask';
import { isManifest, type Resource, type ResourceBundle } from './DocumentResources';
export const RESOURCES = 'resources';
export const PREVIEWS = 'previews';
export type { ResourceBundle } from './DocumentResources';

/** Queue every resource read while the transaction is active; callbacks never await. */
export async function hydrateStored(data: any, store: IDBObjectStore): Promise<any> {
  if (!isManifest(data)) return data;
  if (!Array.isArray(data.resources) || !data.resources.every(key => typeof key === 'string') || !data.document) throw new Error('Invalid stored document manifest');
  return Promise.all(data.resources.map(key => new Promise<[string, Resource]>((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => typeof req.result?.payload === 'string' && typeof req.result.shape === 'string' ? resolve([key, req.result]) : reject(new Error(`Missing document resource: ${key}`));
    req.onerror = () => reject(req.error);
  }))).then(entries => runTask('hydrateStorageDocument', { data, resources: entries }));
}

export function writeResources(tx: IDBTransaction, bundle: ResourceBundle) {
  const store = tx.objectStore(RESOURCES);
  for (const [key, payload] of bundle.payloads) {
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result === undefined) store.put(payload, key);
      else if (req.result.payload !== payload.payload || req.result.shape !== payload.shape) tx.abort(); // corrupted resource or digest collision
    };
  }
}

export function writePreview(tx: IDBTransaction, key: string, thumb: string) {
  const store = tx.objectStore(PREVIEWS), req = store.get(key);
  req.onsuccess = () => { if (req.result !== thumb) store.put(thumb, key); };
}

export function referencedResources(value: any, live: Set<string>) {
  if (isManifest(value)) {
    for (const key of Array.isArray(value.resources) ? value.resources : []) if (typeof key === 'string') live.add(key);
    // Retain actual pointers too: damage to a manifest's key inventory must not erase its pixels.
    const array = (items: any) => Array.isArray(items) ? items : [];
    const retain = (owner: any, field: string) => {
      const key = owner?.[field]?.$resource;
      if (typeof key === 'string') live.add(key);
    };
    for (const image of array(value.document?.images)) retain(image, 'd');
    for (const tileset of array(value.document?.tilesets)) retain(tileset, 'd');
    for (const layer of array(value.document?.layers)) for (const cel of array(layer?.cels)) {
      retain(cel, 'd'); retain(cel, 't');
    }
  } else if (value?.data) referencedResources(value.data, live); // session last-good wrapper
}
