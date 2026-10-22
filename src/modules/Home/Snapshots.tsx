import { listSnapshots, SNAPSHOTS_KEPT, type SnapshotMeta } from "~/core/Projects";
import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { Button, Muted } from "~/ui/Button";
import { Dialog, openDialog } from "~/ui/Dialog";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px;
  background: var(--face);
  border: 1px solid var(--b1);

  & > img { width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; background: var(--workspace); }
  & > div { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** Recovery snapshots (of one project, or the newest of all), each with a Restore button */
export const SnapshotList: FC<{ owner?: string; limit?: number; onRestore?: () => void; }> = ({ owner, limit, onRestore }) => {
  useSignals();
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  void state.prefs.language;

  useEffect(() => {
    let alive = true;
    listSnapshots(owner).then(s => { if (alive) setSnaps(s); }).catch(() => setSnaps([]));
    return () => { alive = false; };
  }, [owner, state.projectsVersion]);

  if (snaps === null) return <Muted>{t('home.loading')}</Muted>;
  if (!snaps.length) return <Muted>{t('home.noSnapshotsYet')}</Muted>;
  return (
    <List>
      {snaps.slice(0, limit).map(s => (
        <Item key={s.id} title={`${s.name} · ${s.width}×${s.height} · ${s.frames} ${t('common.framesLower')}`}>
          {s.thumb ? <img src={s.thumb} alt="" /> : null}
          <div>{s.name}<br /><Muted>{new Date(s.time).toLocaleString()}</Muted></div>
          <Button onClick={() => { void state.openSnapshot(s.id); onRestore?.(); }}>{t('home.restore')}</Button>
        </Item>
      ))}
    </List>
  );
};

export const openSnapshots = (owner: string, name: string) => openDialog(close => (
  <Dialog title={t('home.snapshotsOfName', { name })} onClose={close} cancelLabel={t('common.close')}>
    <Muted>{t('home.theLastNAutomatic', { n: SNAPSHOTS_KEPT })}</Muted>
    <SnapshotList owner={owner} onRestore={close} />
  </Dialog>
));
