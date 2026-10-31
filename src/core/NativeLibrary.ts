import { runTask } from './BackgroundTask';

export let nativeLibrary = false;
export const enableNativeLibrary = () => { nativeLibrary = true; };
export type LibraryGroup = 'projects' | 'sessions' | 'snapshots' | 'goodProjects' | 'goodSessions' | 'states' | 'folders';
export type LibraryRecord = { id?: string; meta?: unknown; data?: unknown; head?: unknown; editor?: unknown; validated?: boolean };
export type LibraryInfo = { path: string; migrated: boolean };

/** Document serialization happens in the compute worker; IPC carries raw UTF-8 bytes. */
export async function libraryCall<T = void>(request: { action: string; group?: LibraryGroup; id?: string; record?: LibraryRecord; patch?: boolean; backup?: boolean; tombstone?: boolean }): Promise<T> {
  const bridge = window.pixpriteDesktop?.library;
  if (!bridge) throw new Error('Native library is unavailable');
  const bytes = request.record?.data === undefined
    ? new TextEncoder().encode(JSON.stringify(request))
    : await runTask('jsonBytes', { data: request });
  return bridge(bytes);
}

export const libraryGet = <T = LibraryRecord>(group: LibraryGroup, id: string) => libraryCall<T | null>({ action: 'get', group, id });
export const libraryList = <T = LibraryRecord>(group: LibraryGroup) => libraryCall<T[]>({ action: 'list', group });
export const libraryPut = (group: LibraryGroup, id: string, record: LibraryRecord, backup = false, patch = false) => libraryCall({ action: 'put', group, id, record, backup, patch });
export const libraryDelete = (group: LibraryGroup, id: string, tombstone = false) => libraryCall({ action: 'delete', group, id, tombstone });
