import { useEffect, useState, type FC } from 'react';
import { allProjectsBackup, backupDue, backupHistory, recordBackup, snoozeBackup } from '~/core/Backups';
import { download } from '~/core/Files';
import { cleanOldSnapshots, listSnapshots, storageEstimate, type ProjectMeta } from '~/core/Projects';
import { formatBytes, persistentStorage, requestPersistentStorage, storageNearlyFull } from '~/core/Storage';
import { state } from '~/core/State';
import { t } from '~/core/i18n';
import { Button, Muted, Select } from '~/ui/Button';
import { askConfirm } from '~/ui/Dialog';

export const StoragePanel: FC<{ projects: ProjectMeta[] | null }> = ({ projects }) => {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [snapshots, setSnapshots] = useState({ count: 0, bytes: 0 });
  const [history, setHistory] = useState(backupHistory);
  const [keep, setKeep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    persistentStorage().then(value => { if (alive) setPersisted(value); });
    storageEstimate().then(value => { if (alive) setUsage(value); });
    listSnapshots().then(items => {
      if (alive) setSnapshots({ count: items.length, bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0) });
    }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [projects, state.projectsVersion]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(`${t('storage.failed')}: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy(false); }
  };

  return <section aria-label={t('storage.title')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <b>{t('storage.title')}</b>
    <Muted>{persisted === true ? t('storage.persisted') : persisted === false ? t('storage.temporary') : t('storage.unsupported')}</Muted>
    {persisted !== true && <Button disabled={busy || persisted === null} onClick={() => void run(async () => {
      setPersisted(await requestPersistentStorage());
    })}>{t('storage.requestPersistence')}</Button>}
    {usage && <Muted>{t('home.storage')}: {formatBytes(usage.used)}{usage.quota ? ` / ${formatBytes(usage.quota)}` : ''}</Muted>}
    {storageNearlyFull(usage) && <p role="alert">{t('storage.nearlyFull')}</p>}
    <Muted>{t('storage.snapshotUsage', { n: snapshots.count, size: formatBytes(snapshots.bytes) })}</Muted>
    <Muted>{t('storage.payloadSizes')}</Muted>
    <label>{t('storage.keepSnapshots')} <Select aria-label={t('storage.keepSnapshots')} value={keep} onChange={e => setKeep(+e.target.value)}>
      {[1, 3, 5].map(n => <option value={n} key={n}>{n}</option>)}
    </Select></label>
    <Button disabled={busy || !snapshots.count} onClick={() => void run(async () => {
      if (!await askConfirm(t('storage.cleanConfirm', { n: keep }), { title: t('storage.cleanSnapshots'), ok: t('common.delete') })) return;
      await cleanOldSnapshots(keep);
      state.projectsVersion++;
    })}>{t('storage.cleanSnapshots')}</Button>
    <Muted>{t('storage.backupSavedOnly')}</Muted>
    <Button disabled={busy || !projects?.length} onClick={() => void run(async () => {
      const backup = await allProjectsBackup();
      download(backup.blob, backup.name);
      recordBackup(undefined, backup.savedAt); setHistory(backupHistory());
    })}>{t('storage.backupAll')}</Button>
    {projects && backupDue(projects, history) && <div role="status">
      <p>{t('storage.backupReminder')}</p>
      <Button onClick={() => { snoozeBackup(); setHistory(backupHistory()); }}>{t('storage.remindLater')}</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
};
