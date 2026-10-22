/**
 * Project storage in IndexedDB: a light "meta" record per project (name, size, thumbnail)
 * for the home page, and the full document in a separate store.
 * Folders only group the meta records; documents never move.
 */

import type { ProjectInfo } from "~/core/Sprite";
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
    // 5: folders. Existing projects have no folderId and so stay in the root; other stores are untouched
    const req = indexedDB.open(DB, 5);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA);
      if (!d.objectStoreNames.contains(STATE)) d.createObjectStore(STATE);
      if (!d.objectStoreNames.contains(SESSIONS)) d.createObjectStore(SESSIONS);
      if (!d.objectStoreNames.contains(SNAP_META)) d.createObjectStore(SNAP_META, { keyPath: 'id' }).createIndex('owner', 'owner');
      if (!d.objectStoreNames.contains(SNAP_DATA)) d.createObjectStore(SNAP_DATA);
      if (!d.objectStoreNames.contains(FOLDERS)) d.createObjectStore(FOLDERS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const newProjectId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** All projects, most recently changed first */
export async function listProjects(): Promise<ProjectMeta[]> {
  const tx = (await db()).transaction(META, 'readonly');
  const all = await request(tx.objectStore(META).getAll() as IDBRequest<ProjectMeta[]>);
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveProjectData(meta: ProjectMeta, data: unknown) {
  const tx = (await db()).transaction([META, DATA], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(DATA).put(data, meta.id);
  await done(tx);
}

export async function loadProjectData(id: string): Promise<unknown | null> {
  const tx = (await db()).transaction(DATA, 'readonly');
  return (await request(tx.objectStore(DATA).get(id))) ?? null;
}

export async function getProjectMeta(id: string): Promise<ProjectMeta | null> {
  const tx = (await db()).transaction(META, 'readonly');
  return (await request(tx.objectStore(META).get(id) as IDBRequest<ProjectMeta | undefined>)) ?? null;
}

export async function deleteProject(id: string) {
  const tx = (await db()).transaction([META, DATA, STATE], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  tx.objectStore(STATE).delete(id);
  await done(tx);
  await deleteSnapshots(id).catch(() => { });
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
  tx.objectStore(META).put({ ...meta, folderId });
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
    for (const p of projects) if (p.folderId === id) tx.objectStore(META).put({ ...p, folderId: folder.parentId });
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

/** Saves part of an open editor: its working document, its editor state, or its header */
export async function saveSession(id: string, part: 'data' | 'editor' | 'head', value: unknown) {
  const tx = (await db()).transaction(SESSIONS, 'readwrite');
  tx.objectStore(SESSIONS).put(value, `${part}:${id}`);
  await done(tx);
}

export async function loadSession(id: string) {
  const tx = (await db()).transaction(SESSIONS, 'readonly');
  const s = tx.objectStore(SESSIONS);
  const [head, data, editor] = await Promise.all([
    request(s.get(`head:${id}`)), request(s.get(`data:${id}`)), request(s.get(`editor:${id}`)),
  ]);
  return data ? { head: head as SessionHead | undefined, data: data as unknown, editor: (editor ?? null) as Record<string, unknown> | null } : null;
}

export async function deleteSession(id: string) {
  const tx = (await db()).transaction(SESSIONS, 'readwrite');
  const s = tx.objectStore(SESSIONS);
  for (const part of ['head', 'data', 'editor']) s.delete(`${part}:${id}`);
  await done(tx);
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
};

/** How many snapshots are kept per project */
export const SNAPSHOTS_KEPT = 10;

/** Adds a snapshot and drops the oldest ones beyond `keep` */
export async function saveSnapshot(meta: Omit<SnapshotMeta, 'id' | 'time'>, data: unknown, keep = SNAPSHOTS_KEPT) {
  const time = Date.now();
  const id = `${meta.owner}:${time}`;
  const d = await db();
  const tx = d.transaction([SNAP_META, SNAP_DATA], 'readwrite');
  tx.objectStore(SNAP_META).put({ ...meta, id, time } satisfies SnapshotMeta);
  tx.objectStore(SNAP_DATA).put(data, id);
  await done(tx);
  const old = (await listSnapshots(meta.owner)).slice(keep);
  if (old.length) await deleteSnapshotIds(old.map(s => s.id));
}

/** Snapshots of one owner (or all), newest first */
export async function listSnapshots(owner?: string): Promise<SnapshotMeta[]> {
  const tx = (await db()).transaction(SNAP_META, 'readonly');
  const store = tx.objectStore(SNAP_META);
  const req = owner === undefined ? store.getAll() : store.index('owner').getAll(owner);
  const all = await request(req as IDBRequest<SnapshotMeta[]>);
  return all.sort((a, b) => b.time - a.time);
}

export async function loadSnapshot(id: string): Promise<unknown | null> {
  const tx = (await db()).transaction(SNAP_DATA, 'readonly');
  return (await request(tx.objectStore(SNAP_DATA).get(id))) ?? null;
}

async function deleteSnapshotIds(ids: string[]) {
  const tx = (await db()).transaction([SNAP_META, SNAP_DATA], 'readwrite');
  for (const id of ids) { tx.objectStore(SNAP_META).delete(id); tx.objectStore(SNAP_DATA).delete(id); }
  await done(tx);
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
