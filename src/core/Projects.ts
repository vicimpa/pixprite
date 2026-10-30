/**
 * Project storage in IndexedDB: a light "meta" record per project (name, size, thumbnail)
 * for the home page, and the full document in a separate store.
 * Folders only group the meta records; documents never move.
 */

import { hydrateStored, PREVIEWS, referencedResources, RESOURCES, writePreview, writeResources } from "./DocumentStorage";
import { BackgroundWorkerError, runTask } from "~/core/BackgroundTask";
import { Sprite, type ProjectInfo } from "~/core/Sprite";
import { signal } from "@preact/signals-react";

export type ProjectMeta = {
  id: string;
  name: string;
  created: number;
  updated: number;
  width: number;
  height: number;
  frames: number;
  layers: number;
  colorMode: string;
  /** Small PNG preview as a data URL */
  thumb: string;
  /** UTF-8 bytes of the serialized document, excluding database overhead. */
  bytes?: number;
  /** Containing folder; the root when absent */
  folderId?: string | null;
  /** Description, tags, genre, author (a copy of the document's, for the home page) */
  info?: ProjectInfo;
};

export type FolderMeta = {
  id: string;
  name: string;
  /** Containing folder; null for the root */
  parentId: string | null;
  created: number;
  updated: number;
};

const DB = 'pixprite';
const META = 'meta';
const DATA = 'data';
const GOOD_DATA = 'lastGoodData';
const GOOD_META = 'lastGoodMeta';
/** Compare-and-write tokens for cross-tab validation outside write transactions. */
const REVISIONS = 'revisions';
/** How the editor was set up for each project (tools, view, panels); kept apart from the project itself */
const STATE = 'state';
/**
 * Open editors: the working copy of every open tab (unsaved edits included) and its editor state.
 * Project files above change only when the user saves.
 */
const SESSIONS = 'sessions';
/** Timed copies of the working document for recovery: light records (by owner) and their documents */
const SNAP_META = 'snapshots';
const SNAP_DATA = 'snapshotData';
/** Home page folders (nesting through parentId) */
const FOLDERS = 'folders';

let opening: Promise<IDBDatabase> | null = null;

function db() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    // 8: immutable resources and previews; inline v3-v5 records migrate lazily on write.
    const req = indexedDB.open(DB, 8);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(RESOURCES)) d.createObjectStore(RESOURCES);
      if (!d.objectStoreNames.contains(PREVIEWS)) d.createObjectStore(PREVIEWS);
      if (!d.objectStoreNames.contains(REVISIONS)) d.createObjectStore(REVISIONS);
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA);
      if (!d.objectStoreNames.contains(GOOD_DATA)) d.createObjectStore(GOOD_DATA);
      if (!d.objectStoreNames.contains(GOOD_META)) d.createObjectStore(GOOD_META, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(STATE)) d.createObjectStore(STATE);
      if (!d.objectStoreNames.contains(SESSIONS)) d.createObjectStore(SESSIONS);
      if (!d.objectStoreNames.contains(SNAP_META)) d.createObjectStore(SNAP_META, { keyPath: 'id' }).createIndex('owner', 'owner');
      if (!d.objectStoreNames.contains(SNAP_DATA)) d.createObjectStore(SNAP_DATA);
      if (!d.objectStoreNames.contains(FOLDERS)) d.createObjectStore(FOLDERS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opening = null; };
      resolve(req.result);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new DOMException('Storage transaction aborted', 'AbortError'));
  });
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Hydration requests are queued in the IDB callback, in the same readonly snapshot. */
function documentRequest(tx: IDBTransaction, store: string, key: string) {
  return new Promise<any>((resolve, reject) => {
    const req = tx.objectStore(store).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { hydrateStored(req.result, tx.objectStore(RESOURCES)).then(resolve, reject); };
  });
}

async function readDocument(store: string, key: string) {
  const tx = (await db()).transaction([store, RESOURCES], 'readonly');
  return documentRequest(tx, store, key);
}

function withoutThumb<T extends { thumb: string }>(meta: T) {
  const { thumb: _, ...rest } = meta;
  return rest;
}

/** Metadata and its separately stored preview are read in the same database snapshot. */
async function readMetadata<T extends { id: string; thumb: string }>(store: string, prefix: string, owner?: string): Promise<T[]> {
  const tx = (await db()).transaction([store, PREVIEWS], 'readonly');
  return new Promise((resolve, reject) => {
    const records = owner === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).index('owner').getAll(owner);
    records.onerror = () => reject(records.error);
    records.onsuccess = () => {
      const all = records.result as T[];
      Promise.all(all.map(async meta => {
        meta.thumb = (await request(tx.objectStore(PREVIEWS).get(`${prefix}:${meta.id}`))) ?? meta.thumb ?? '';
      })).then(() => resolve(all), reject);
    };
  });
}

let resourceCleanupPending = false;
/** Deferred maintenance is independent of successful save/dirty markers and owns no Sprite. */
function scheduleResourceCleanup() {
  if (typeof window === 'undefined' || resourceCleanupPending) return;
  resourceCleanupPending = true;
  window.setTimeout(() => {
    const clean = () => {
      void collectUnusedResources().catch(error => console.warn('Resource cleanup failed', error))
        .finally(() => { resourceCleanupPending = false; });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(clean, { timeout: 5000 });
    else clean();
  }, 1000);
}

/** One transaction scans all owners, so concurrent saves and deletion cannot race collection. */
export async function collectUnusedResources() {
  const owners = [DATA, GOOD_DATA, SESSIONS, SNAP_DATA];
  const tx = (await db()).transaction([...owners, RESOURCES], 'readwrite');
  const committed = done(tx), live = new Set<string>();
  let remaining = owners.length;
  for (const owner of owners) {
    const req = tx.objectStore(owner).getAll();
    req.onsuccess = () => {
      for (const value of req.result) referencedResources(value, live);
      if (--remaining) return;
      const resources = tx.objectStore(RESOURCES), cursor = resources.openKeyCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!live.has(String(item.key))) resources.delete(item.primaryKey);
        item.continue();
      };
    };
  }
  await committed;
}

export class DeletedDocumentError extends Error {
  constructor() { super('Document was deleted while saving'); this.name = 'DeletedDocumentError'; }
}
const deletedRevision = (value: unknown) => typeof value === 'string' && value.startsWith('deleted:');

export const newProjectId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** All projects, most recently changed first */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await readMetadata<ProjectMeta>(META, 'project');
  const missing = all.filter(p => p.bytes === undefined);
  if (missing.length) {
    const values = missing.map(p => readDocument(DATA, p.id));
    await Promise.all(missing.map(async (p, i) => {
      try {
        const data = await values[i];
        if (data !== undefined) p.bytes = await runTask('inspectDocument', { data });
      } catch { /* isolate damaged manifests, missing resources and malformed inline records */ }
    }));
  }
  return all.sort((a, b) => b.updated - a.updated);
}

/** Full document decoding validates buffers and resource references before opening a write transaction. */
export function validateStoredDocument(data: unknown) {
  const document = new Sprite(1, 1);
  document.load(data);
}

export async function validateStoredDocumentAsync(data: unknown) {
  return runTask('inspectDocument', { data });
}

async function validDocument(data: unknown) {
  if (data === undefined) return false;
  try { await validateStoredDocumentAsync(data); return true; } catch (error) {
    if (error instanceof BackgroundWorkerError) throw error;
    return false;
  }
}

/** Read payload and token in one snapshot, validate off-thread, then compare the token atomically. */
async function previousRevision(store: string, key: string, revision: string) {
  const tx = (await db()).transaction([store, REVISIONS, RESOURCES], 'readonly');
  const stored = request(tx.objectStore(store).get(key));
  const decoded = documentRequest(tx, store, key).then(data => ({ data }), error => ({ data: undefined, error }));
  const [payload, token, original] = await Promise.all([decoded, request(tx.objectStore(REVISIONS).get(revision)), stored]);
  if ('error' in payload && payload.error instanceof BackgroundWorkerError) throw payload.error;
  const data = payload.data;
  if (deletedRevision(token)) throw new DeletedDocumentError();
  return { data: original, token, valid: await validDocument(data) };
}

export async function saveProjectData(meta: ProjectMeta, data: unknown, editor?: unknown) {
  const copy = structuredClone(data), nextMeta = structuredClone(meta), nextEditor = structuredClone(editor);
  const id = nextMeta.id;
  const next = { ...nextMeta, bytes: await validateStoredDocumentAsync(copy) };
  const bundle = await runTask('splitStorageDocument', { data: copy });
  const revision = `project:${id}`;
  for (;;) {
    const previous = await previousRevision(DATA, id, revision);
    const tx = (await db()).transaction([META, DATA, GOOD_META, GOOD_DATA, STATE, REVISIONS, RESOURCES, PREVIEWS], 'readwrite');
    const committed = done(tx);
    let retry = false, deleted = false;
    const oldMeta = tx.objectStore(META).get(id);
    const oldPreview = tx.objectStore(PREVIEWS).get(`project:${id}`);
    const token = tx.objectStore(REVISIONS).get(revision);
    token.onsuccess = () => {
      if (deletedRevision(token.result)) { deleted = true; return; }
      if (token.result !== previous.token) { retry = true; return; }
      if (oldMeta.result && previous.valid) {
        tx.objectStore(GOOD_META).put(withoutThumb(oldMeta.result));
        writePreview(tx, `good:${id}`, oldPreview.result ?? oldMeta.result.thumb ?? '');
        tx.objectStore(GOOD_DATA).put(previous.data, id);
      } else if (previous.data === undefined) {
        tx.objectStore(GOOD_META).put(withoutThumb(next));
        writePreview(tx, `good:${id}`, next.thumb);
        tx.objectStore(GOOD_DATA).put(bundle.manifest, id);
      }
      writeResources(tx, bundle);
      writePreview(tx, `project:${id}`, next.thumb);
      tx.objectStore(META).put(withoutThumb(next));
      tx.objectStore(DATA).put(bundle.manifest, id);
      tx.objectStore(REVISIONS).put(newProjectId(), revision);
      if (nextEditor !== undefined) tx.objectStore(STATE).put(nextEditor, id);
    };
    await committed;
    if (deleted) throw new DeletedDocumentError();
    if (!retry) { scheduleResourceCleanup(); return; }
  }
}

/** Explicit recovery only: callers open this as a new unsaved document. */
export async function loadLastGoodProject(id: string) {
  const tx = (await db()).transaction([GOOD_META, GOOD_DATA, RESOURCES, PREVIEWS], 'readonly');
  const [meta, data, thumb] = await Promise.all([
    request(tx.objectStore(GOOD_META).get(id)), documentRequest(tx, GOOD_DATA, id), request(tx.objectStore(PREVIEWS).get(`good:${id}`)),
  ]);
  if (!meta || !data) return null;
  await validateStoredDocumentAsync(data);
  return { meta: { ...meta, thumb: thumb ?? meta.thumb ?? '' } as ProjectMeta, data: data as unknown };
}

export async function loadProjectData(id: string): Promise<unknown | null> {
  return (await readDocument(DATA, id)) ?? null;
}

export async function getProjectMeta(id: string): Promise<ProjectMeta | null> {
  const tx = (await db()).transaction([META, PREVIEWS], 'readonly');
  const [meta, thumb] = await Promise.all([request(tx.objectStore(META).get(id) as IDBRequest<ProjectMeta | undefined>), request(tx.objectStore(PREVIEWS).get(`project:${id}`))]);
  return meta ? { ...meta, thumb: thumb ?? meta.thumb ?? '' } : null;
}

export async function deleteProject(id: string) {
  const tx = (await db()).transaction([META, DATA, STATE, GOOD_META, GOOD_DATA, REVISIONS, PREVIEWS], 'readwrite');
  tx.objectStore(REVISIONS).put(`deleted:${newProjectId()}`, `project:${id}`);
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  tx.objectStore(STATE).delete(id);
  tx.objectStore(GOOD_META).delete(id);
  tx.objectStore(GOOD_DATA).delete(id);
  tx.objectStore(PREVIEWS).delete(`project:${id}`);
  tx.objectStore(PREVIEWS).delete(`good:${id}`);
  await done(tx);
  await deleteSnapshots(id).catch(() => { });
  await collectUnusedResources();
}

/** A copy of a stored project next to it, under a new name; returns the new id */
export async function duplicateProject(id: string, name: string) {
  const [meta, data] = await Promise.all([getProjectMeta(id), loadProjectData(id) as Promise<{ name?: string; } | null>]);
  if (!meta || !data) return null;
  const now = Date.now();
  const copy = newProjectId();
  await saveProjectData({ ...meta, id: copy, name, created: now, updated: now }, { ...data, name });
  return copy;
}

export async function saveProjectState(id: string, editor: unknown) {
  const tx = (await db()).transaction(STATE, 'readwrite');
  tx.objectStore(STATE).put(editor, id);
  await done(tx);
}

export async function loadProjectState(id: string): Promise<Record<string, unknown> | null> {
  const tx = (await db()).transaction(STATE, 'readonly');
  return (await request(tx.objectStore(STATE).get(id))) ?? null;
}

export async function renameProject(id: string, name: string) {
  const meta = await getProjectMeta(id);
  const data = await loadProjectData(id) as { name?: string; } | null;
  if (!meta || !data) return;
  await saveProjectData({ ...meta, name, updated: Date.now() }, { ...data, name });
}

/** Changes the info of a stored project without opening it */
export async function updateProjectInfo(id: string, info: ProjectInfo) {
  const meta = await getProjectMeta(id);
  const data = await loadProjectData(id) as Record<string, unknown> | null;
  if (!meta || !data) return;
  const has = Object.keys(info).length > 0;
  const { info: _, ...rest } = data;
  await saveProjectData({ ...meta, info: has ? info : undefined, updated: Date.now() }, has ? { ...rest, info } : rest);
}

/** The folder the home page shows; new projects land there. Remembered between visits */
const LAST_FOLDER = 'pixprite:homeFolder';
export const homeFolder = signal<string | null>((() => {
  try { return localStorage.getItem(LAST_FOLDER) || null; } catch { return null; }
})());

export function setHomeFolder(id: string | null) {
  homeFolder.value = id;
  try { id ? localStorage.setItem(LAST_FOLDER, id) : localStorage.removeItem(LAST_FOLDER); } catch { /* storage blocked */ }
}

export async function listFolders(): Promise<FolderMeta[]> {
  const tx = (await db()).transaction(FOLDERS, 'readonly');
  return request(tx.objectStore(FOLDERS).getAll() as IDBRequest<FolderMeta[]>);
}

export async function saveFolder(folder: FolderMeta) {
  const tx = (await db()).transaction(FOLDERS, 'readwrite');
  tx.objectStore(FOLDERS).put(folder);
  await done(tx);
}

export async function createFolder(name: string, parentId: string | null) {
  const now = Date.now();
  const folder: FolderMeta = { id: newProjectId(), name, parentId, created: now, updated: now };
  await saveFolder(folder);
  return folder;
}

/** Folder ids from the root down to `id` (empty for the root) */
export function folderPath(folders: FolderMeta[], id: string | null | undefined) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const path: FolderMeta[] = [];
  // The guard stops a broken (cyclic) record from hanging the page
  for (let f = id ? byId.get(id) : undefined; f && path.length <= folders.length; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f);
  return path;
}

/** `id` and every folder inside it, at any depth */
export function folderSubtree(folders: FolderMeta[], id: string) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** Moves a project into a folder (null: the root); the project's own time is kept */
export async function moveProject(id: string, folderId: string | null) {
  const meta = await getProjectMeta(id);
  if (!meta) return;
  const tx = (await db()).transaction(META, 'readwrite');
  tx.objectStore(META).put(withoutThumb({ ...meta, folderId }));
  await done(tx);
}

/** Moves a folder; refused (false) when the target is the folder itself or inside it */
export async function moveFolder(id: string, parentId: string | null) {
  const folders = await listFolders();
  const folder = folders.find(f => f.id === id);
  if (!folder || (parentId && folderSubtree(folders, id).has(parentId))) return false;
  await saveFolder({ ...folder, parentId, updated: Date.now() });
  return true;
}

/**
 * Removes a folder. 'lift' moves its folders and projects one level up;
 * 'all' deletes everything inside, projects with their snapshots. Returns the deleted project ids.
 */
export async function deleteFolder(id: string, mode: 'lift' | 'all') {
  const folders = await listFolders();
  const folder = folders.find(f => f.id === id);
  if (!folder) return [];
  const projects = await listProjects();
  if (mode === 'lift') {
    const tx = (await db()).transaction([FOLDERS, META], 'readwrite');
    for (const f of folders) if (f.parentId === id) tx.objectStore(FOLDERS).put({ ...f, parentId: folder.parentId });
    for (const p of projects) if (p.folderId === id) tx.objectStore(META).put(withoutThumb({ ...p, folderId: folder.parentId }));
    tx.objectStore(FOLDERS).delete(id);
    await done(tx);
    return [];
  }
  const gone = folderSubtree(folders, id);
  const doomed = projects.filter(p => p.folderId && gone.has(p.folderId)).map(p => p.id);
  for (const p of doomed) await deleteProject(p);
  const tx = (await db()).transaction(FOLDERS, 'readwrite');
  for (const f of gone) tx.objectStore(FOLDERS).delete(f);
  await done(tx);
  return doomed;
}

export type SessionHead = { projectId: string | null; name: string; };

export type SessionRecord = { head?: SessionHead; data: unknown; editor: Record<string, unknown> | null };

/** Header, working pixels and editor state either all commit or all stay at their previous values. */
export async function saveSessionRecord(id: string, value: SessionRecord, changed = true) {
  const copy = structuredClone(value);
  if (changed) await validateStoredDocumentAsync(copy.data);
  const bundle = changed ? await runTask('splitStorageDocument', { data: copy.data }) : null;
  const revision = `session:${id}`;
  for (;;) {
    const previous = changed ? await previousRevision(SESSIONS, `data:${id}`, revision) : null;
    const tx = (await db()).transaction([SESSIONS, REVISIONS, RESOURCES], 'readwrite');
    const committed = done(tx), store = tx.objectStore(SESSIONS);
    let retry = false, deleted = false;
    const head = store.get(`head:${id}`), editor = store.get(`editor:${id}`);
    const token = tx.objectStore(REVISIONS).get(revision);
    token.onsuccess = () => {
      if (deletedRevision(token.result)) { deleted = true; return; }
      if (previous && token.result !== previous.token) { retry = true; return; }
      if (previous?.valid) store.put({ head: head.result, data: previous.data, editor: editor.result ?? null }, `good:${id}`);
      else if (previous && previous.data === undefined) store.put({ ...copy, data: bundle!.manifest }, `good:${id}`);
      store.put(copy.head, `head:${id}`);
      if (changed) {
        writeResources(tx, bundle!);
        store.put(bundle!.manifest, `data:${id}`);
        tx.objectStore(REVISIONS).put(newProjectId(), revision);
      }
      store.put(copy.editor, `editor:${id}`);
    };
    await committed;
    if (deleted) throw new DeletedDocumentError();
    if (!retry) { if (changed) scheduleResourceCleanup(); return; }
  }
}

export async function loadLastGoodSession(id: string): Promise<SessionRecord | null> {
  const tx = (await db()).transaction([SESSIONS, RESOURCES], 'readonly');
  const record = await new Promise<any>((resolve, reject) => {
    const req = tx.objectStore(SESSIONS).get(`good:${id}`);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      if (!req.result) return resolve(null);
      const record = req.result;
      hydrateStored(record.data, tx.objectStore(RESOURCES)).then(data => resolve({ ...record, data }), reject);
    };
  });
  if (!record) return null;
  await validateStoredDocumentAsync(record.data);
  return record;
}

export async function loadSession(id: string) {
  const tx = (await db()).transaction([SESSIONS, RESOURCES], 'readonly');
  const s = tx.objectStore(SESSIONS);
  const [head, data, editor] = await Promise.all([
    request(s.get(`head:${id}`)), documentRequest(tx, SESSIONS, `data:${id}`), request(s.get(`editor:${id}`)),
  ]);
  return data ? { head: head as SessionHead | undefined, data: data as unknown, editor: (editor ?? null) as Record<string, unknown> | null } : null;
}

export async function deleteSession(id: string) {
  const tx = (await db()).transaction([SESSIONS, REVISIONS], 'readwrite');
  tx.objectStore(REVISIONS).put(`deleted:${newProjectId()}`, `session:${id}`);
  const s = tx.objectStore(SESSIONS);
  for (const part of ['head', 'data', 'editor', 'good']) s.delete(`${part}:${id}`);
  await done(tx);
  await collectUnusedResources();
}

/** Storage used and available (when the browser reports it) */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch { return null; }
}

export type SnapshotMeta = {
  id: string;
  /** Project id, or the open editor's session id for never-saved work */
  owner: string;
  time: number;
  name: string;
  width: number;
  height: number;
  frames: number;
  thumb: string;
  bytes?: number;
};

/** How many snapshots are kept per project */
export const SNAPSHOTS_KEPT = 10;
let lastSnapshotTime = 0;

/** Adds a snapshot and drops the oldest ones beyond `keep` */
export async function saveSnapshot(meta: Omit<SnapshotMeta, 'id' | 'time'>, data: unknown, keep = SNAPSHOTS_KEPT) {
  const copy = structuredClone(data), capturedMeta = structuredClone(meta);
  const bytes = await validateStoredDocumentAsync(copy);
  const bundle = await runTask('splitStorageDocument', { data: copy });
  const time = lastSnapshotTime = Math.max(Date.now(), lastSnapshotTime + 1);
  const id = `${capturedMeta.owner}:${time}:${newProjectId()}`;
  const d = await db();
  const tx = d.transaction([SNAP_META, SNAP_DATA, REVISIONS, RESOURCES, PREVIEWS], 'readwrite');
  const committed = done(tx);
  let deleted = false;
  const project = tx.objectStore(REVISIONS).get(`project:${capturedMeta.owner}`);
  const session = tx.objectStore(REVISIONS).get(`session:${capturedMeta.owner}`);
  session.onsuccess = () => {
    if (deletedRevision(project.result) || deletedRevision(session.result)) { deleted = true; return; }
    tx.objectStore(SNAP_META).put(withoutThumb({ ...capturedMeta, id, time, bytes } satisfies SnapshotMeta));
    writeResources(tx, bundle);
    writePreview(tx, `snapshot:${id}`, capturedMeta.thumb);
    tx.objectStore(SNAP_DATA).put(bundle.manifest, id);
  };
  await committed;
  if (deleted) throw new DeletedDocumentError();
  scheduleResourceCleanup();
  const old = (await listSnapshots(capturedMeta.owner)).slice(keep);
  if (old.length) await deleteSnapshotIds(old.map(s => s.id));
}

/** Snapshots of one owner (or all), newest first */
export async function listSnapshots(owner?: string): Promise<SnapshotMeta[]> {
  const all = await readMetadata<SnapshotMeta>(SNAP_META, 'snapshot', owner);
  const missing = all.filter(s => s.bytes === undefined);
  if (missing.length) {
    const values = missing.map(s => readDocument(SNAP_DATA, s.id));
    await Promise.all(missing.map(async (s, i) => {
      try {
        const value = await values[i];
        if (value !== undefined) s.bytes = await runTask('inspectDocument', { data: value });
      } catch { /* isolate damaged manifests, missing resources and malformed inline records */ }
    }));
  }
  return all.sort((a, b) => b.time - a.time);
}

export async function loadSnapshot(id: string): Promise<unknown | null> {
  return (await readDocument(SNAP_DATA, id)) ?? null;
}

async function deleteSnapshotIds(ids: string[]) {
  const tx = (await db()).transaction([SNAP_META, SNAP_DATA, PREVIEWS], 'readwrite');
  for (const id of ids) { tx.objectStore(SNAP_META).delete(id); tx.objectStore(SNAP_DATA).delete(id); tx.objectStore(PREVIEWS).delete(`snapshot:${id}`); }
  await done(tx);
  await collectUnusedResources();
}

/** Keep at least the newest copy of each owner, including unsaved documents. */
export async function cleanOldSnapshots(keep = 1) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Keep at least one snapshot per project');
  const counts = new Map<string, number>();
  const old = (await listSnapshots()).filter(s => {
    const count = (counts.get(s.owner) ?? 0) + 1;
    counts.set(s.owner, count);
    return count > keep;
  });
  await deleteSnapshotIds(old.map(s => s.id));
  return old.length;
}

export async function deleteSnapshots(owner: string) {
  await deleteSnapshotIds((await listSnapshots(owner)).map(s => s.id));
}

// Clean shutdown marker: set while the app runs, cleared when the page is left normally

const RUNNING = 'pixprite:running';

/** Marks the session as running; returns true when the previous one didn't close cleanly */
export function startSession(): boolean {
  let unclean = false;
  try {
    unclean = localStorage.getItem(RUNNING) === '1';
    localStorage.setItem(RUNNING, '1');
  } catch { /* storage blocked */ }
  addEventListener('pagehide', () => { try { localStorage.removeItem(RUNNING); } catch { /* ignore */ } });
  // Back from the page cache: running again
  addEventListener('pageshow', e => { if (e.persisted) try { localStorage.setItem(RUNNING, '1'); } catch { /* ignore */ } });
  return unclean;
}
