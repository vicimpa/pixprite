import { getProjectMeta, listFolders, listProjects, loadProjectData, type ProjectMeta } from '~/core/Projects';
import { encodeZip } from '~/core/formats/Zip';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const KEY = 'pixprite:externalBackups';
type BackupStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type BackupHistory = { all: number; projects: Record<string, number>; snoozeUntil: number };
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function backupHistory(storage?: BackupStorage): BackupHistory {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup history');
    const projects = value.projects && typeof value.projects === 'object' && !Array.isArray(value.projects)
      ? Object.fromEntries(Object.entries(value.projects).map(([id, time]) => [id, timestamp(time)])) : {};
    return { all: timestamp(value.all), projects, snoozeUntil: timestamp(value.snoozeUntil) };
  } catch { return { all: 0, projects: {}, snoozeUntil: 0 }; }
}

export function backupDue(projects: ProjectMeta[], history: BackupHistory, now = Date.now()) {
  return now >= history.snoozeUntil && projects.some(p => {
    const backed = Math.max(history.all, history.projects[p.id] ?? 0);
    return p.updated > backed && now - Math.max(backed, p.created) >= WEEK;
  });
}

export function recordBackup(id?: string, now = Date.now(), storage?: BackupStorage) {
  const history = backupHistory(storage);
  if (id) history.projects[id] = now;
  else { history.all = now; history.projects = {}; }
  try { (storage ?? localStorage).setItem(KEY, JSON.stringify(history)); } catch { /* download still succeeds */ }
}

export function snoozeBackup(now = Date.now(), storage?: BackupStorage) {
  try { (storage ?? localStorage).setItem(KEY, JSON.stringify({ ...backupHistory(storage), snoozeUntil: now + WEEK })); } catch { /* storage blocked */ }
}

const safeName = (name: string) => name.replace(/[\\/\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+$/, '_').slice(0, 120) || 'project';

/** Saved project files only; active unsaved work remains available through session recovery. */
export async function projectBackup(id: string) {
  const savedAt = Date.now();
  const [meta, data] = await Promise.all([getProjectMeta(id), loadProjectData(id)]);
  if (!meta || !data) throw new Error('Project data is missing');
  return { savedAt, name: `${safeName(meta.name)}.pixprite`, blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) };
}

export async function allProjectsBackup() {
  const savedAt = Date.now();
  const [projects, folders] = await Promise.all([listProjects(), listFolders()]);
  const entries = await Promise.all(projects.map(async meta => {
    const data = await loadProjectData(meta.id);
    if (!data) throw new Error(`Project data is missing: ${meta.name}`);
    return { name: `projects/${safeName(meta.id)}-${safeName(meta.name)}.pixprite`, data: new TextEncoder().encode(JSON.stringify(data)) };
  }));
  entries.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({
    format: 'pixprite-backup', version: 1, created: new Date().toISOString(),
    projects: projects.map((meta, i) => ({ ...meta, file: entries[i].name })), folders,
  }, null, 2)) });
  return { savedAt, name: 'pixprite-backup.zip', blob: new Blob([encodeZip(entries) as BlobPart], { type: 'application/zip' }) };
}
