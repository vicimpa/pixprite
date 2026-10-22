import { loadProjectData, type ProjectMeta } from "~/core/Projects";
import { Sprite } from "~/core/Sprite";
import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { Button, Muted } from "~/ui/Button";
import { Dialog, openDialog } from "~/ui/Dialog";
import { useEffect, useRef, useState, type FC } from "react";
import styled from "styled-components";

/** Longest side of the preview, in screen pixels */
const BOX = 320;

const Stage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  max-height: ${BOX + 16}px;
  padding: 8px;
  background: var(--workspace);
  border: 1px solid var(--b1);

  & > canvas, & > img { image-rendering: pixelated; max-width: 100%; }
`;

const About = styled.div`
  margin-top: 8px;
  white-space: pre-wrap;
  line-height: 1.35;
  max-height: 8em;
  overflow: auto;
`;

const Chips = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  white-space: normal !important;

  & > span { padding: 0 5px; background: var(--b2); color: var(--fg); }
`;

const Facts = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 12px;
  margin-top: 8px;

  & > span:nth-child(odd) { color: var(--fg-dim); }
  & > span:nth-child(even) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** The editor's checkerboard behind a preview: same colors, cells in sprite pixels when it follows the zoom */
export function checker(w: number, h: number) {
  const { checkerA, checkerB, checkerSize, checkerFollowsZoom } = state.prefs;
  const cs = Math.max(1, checkerSize);
  return {
    backgroundImage: `repeating-conic-gradient(${checkerA} 0 25%, ${checkerB} 0 50%)`,
    backgroundSize: checkerFollowsZoom ? `${200 * cs / w}% ${200 * cs / h}%` : `${cs * 2}px ${cs * 2}px`,
  };
}

/** The stored document played frame by frame; the thumbnail stands in until it loads (or when it can't) */
const Player: FC<{ meta: ProjectMeta; }> = ({ meta }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Sprite | null>(null);
  const [failed, setFailed] = useState(false);
  // Whole pixels when the sprite is small, shrunk to fit when it is large
  const fit = BOX / Math.max(meta.width, meta.height);
  const k = fit >= 1 ? Math.floor(fit) : fit;
  const w = Math.max(1, Math.round(meta.width * k)), h = Math.max(1, Math.round(meta.height * k));

  useEffect(() => {
    let alive = true;
    loadProjectData(meta.id).then(data => {
      if (!alive) return;
      if (!data) return setFailed(true);
      const d = new Sprite(32, 32);
      d.load(data);
      setDoc(d);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [meta.id]);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!doc || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    let frame = 0, timer = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(doc.render(frame), 0, 0, w, h);
      if (doc.frames.length < 2) return;
      timer = window.setTimeout(() => { frame = (frame + 1) % doc.frames.length; draw(); }, Math.max(20, doc.frames[frame].duration));
    };
    draw();
    return () => clearTimeout(timer);
  }, [doc, w, h]);

  return (
    <Stage>
      {doc && !failed
        ? <canvas ref={ref} width={w} height={h} style={{ width: w, height: h, ...checker(meta.width, meta.height) }} />
        : meta.thumb ? <img src={meta.thumb} alt="" style={{ width: w, height: h, ...checker(meta.width, meta.height) }} /> : <Muted>{t('home.loading')}</Muted>}
    </Stage>
  );
};

export type PreviewActions = {
  open: () => void;
  rename: () => void;
  moveTo: () => void;
  duplicate: () => void;
  remove: () => void;
  editInfo: () => void;
};

export const openPreview = (meta: ProjectMeta, where: string, act: PreviewActions) => openDialog(close => {
  // Every action leaves the preview first: its details would be out of date afterwards
  const then = (run: () => void) => () => { close(); run(); };
  return (
    <Dialog title={meta.name} width={Math.min(420, innerWidth - 32)} onClose={close}
      submitLabel={t('home.open')} onSubmit={act.open} cancelLabel={t('common.close')}
      extraButtons={<>
        <Button type="button" onClick={then(act.editInfo)}>{t('info.edit')}</Button>
        <Button type="button" onClick={then(act.rename)}>{t('home.rename')}</Button>
        <Button type="button" onClick={then(act.moveTo)}>{t('home.moveTo')}</Button>
        <Button type="button" onClick={then(act.duplicate)}>{t('common.duplicate')}</Button>
        <Button type="button" onClick={then(act.remove)}>{t('home.delete')}</Button>
      </>}>
      <Player meta={meta} />
      {meta.info?.description && <About>{meta.info.description}</About>}
      <Facts>
        {meta.info?.author && <><span>{t('info.author')}</span><span title={meta.info.author}>{meta.info.author}</span></>}
        {meta.info?.genre && <><span>{t('info.genre')}</span><span title={meta.info.genre}>{meta.info.genre}</span></>}
        {meta.info?.tags?.length ? <><span>{t('info.tags')}</span><Chips>{meta.info.tags.map(tag => <span key={tag}>{tag}</span>)}</Chips></> : null}
        <span>{t('common.size')}</span><span>{meta.width}×{meta.height}</span>
        <span>{t('common.frames')}</span><span>{meta.frames}</span>
        <span>{t('common.layers')}</span><span>{meta.layers}</span>
        <span>{t('home.modified')}</span><span>{new Date(meta.updated).toLocaleString()}</span>
        <span>{t('home.folder')}</span><span title={where}>{where}</span>
      </Facts>
    </Dialog>
  );
});
