import { expect, test } from 'bun:test';
import { backupDue, backupHistory, recordBackup, snoozeBackup } from '~/core/Backups';
import type { ProjectMeta } from '~/core/Projects';
import { isQuotaError, persistentStorage, requestPersistentStorage, serializedBytes, storageNearlyFull } from '~/core/Storage';

test('storage APIs tolerate unsupported, denied and rejected persistence requests', async () => {
  expect(await persistentStorage({} as StorageManager)).toBeNull();
  expect(await requestPersistentStorage({} as StorageManager)).toBeNull();
  expect(await requestPersistentStorage({ persist: async () => false } as StorageManager)).toBe(false);
  expect(await requestPersistentStorage({ persist: async () => { throw new Error('blocked'); } } as unknown as StorageManager)).toBeNull();
  expect(await persistentStorage({ persisted: async () => true } as StorageManager)).toBe(true);
});

test('quota warning distinguishes unavailable quota and recognizes browser quota errors', () => {
  expect(storageNearlyFull(null)).toBe(false);
  expect(storageNearlyFull({ used: 99, quota: 0 })).toBe(false);
  expect(storageNearlyFull({ used: 84, quota: 100 })).toBe(false);
  expect(storageNearlyFull({ used: 85, quota: 100 })).toBe(true);
  expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
  expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
  expect(isQuotaError(new Error('other failure'))).toBe(false);
  expect(serializedBytes({ name: 'ёж' })).toBe(new Blob([JSON.stringify({ name: 'ёж' })]).size);
});

test('weekly backup reminder tracks each project and persists snooze independently', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const week = 7 * 86400000;
  const now = 3 * week;
  const projects = ['one', 'two'].map(id => ({ id, created: week, updated: 2 * week } as ProjectMeta));
  expect(backupDue(projects, backupHistory(storage), now)).toBe(true);
  recordBackup('one', now, storage);
  expect(backupDue(projects, backupHistory(storage), now)).toBe(true);
  snoozeBackup(now, storage);
  expect(backupDue(projects, backupHistory(storage), now + week - 1)).toBe(false);
  expect(backupDue(projects, backupHistory(storage), now + week)).toBe(true);
  recordBackup(undefined, now + week, storage);
  expect(backupDue(projects, backupHistory(storage), now + 2 * week)).toBe(false);
  expect(backupDue([{ ...projects[0], updated: now + week + 1 }], backupHistory(storage), now + 2 * week)).toBe(true);
});

test('corrupted or blocked backup history never prevents recording a downloaded backup', () => {
  for (const corrupted of ['null', '"oops"', '[]', '{"projects":"oops","all":-1,"snoozeUntil":"forever"}', '{"projects":{"one":"oops"}}']) {
    let stored = corrupted;
    const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } };
    expect(() => recordBackup('one', 123, storage)).not.toThrow();
    expect(backupHistory(storage)).toMatchObject({ all: 0, projects: { one: 123 }, snoozeUntil: 0 });
  }
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  expect(() => recordBackup('one', 123, blocked)).not.toThrow();
  expect(() => snoozeBackup(123, blocked)).not.toThrow();
});
