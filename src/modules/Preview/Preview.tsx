import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { Button } from "~/ui/Button";
import { Canvas } from "~/ui/Canvas";
import { Icon } from "~/ui/Icon";
import { Select } from "~/ui/Select";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

/**
 * Plays frames on its own clock: the chosen tag (index into `sprite.tags`), or else the tag / loop
 * around the editor's current frame. Follows the tag's direction; a tag with a repeat count stops on its last frame.
 */
function usePreviewFrame(playing: boolean, tagIndex: number) {
  const frame = useRef(state.sprite.frame);
  useEffect(() => {
    if (!playing) return;
    let timer: ReturnType<typeof setTimeout>;
    let pos = -1;
    let key = '';
    const tick = () => {
      const { sprite } = state;
      const range = sprite.tags[tagIndex] ?? sprite.playRange();
      const seq = sprite.tagSequence(range);
      const k = `${range.from}:${range.to}:${range.direction}:${range.repeat ?? 0}`;
      // Restart when the range changes or the frame left it
      if (k !== key || seq[pos] !== frame.current) {
        key = k;
        pos = Math.max(0, seq.indexOf(frame.current));
        frame.current = seq[pos];
      }
      timer = setTimeout(() => {
        if (pos + 1 >= seq.length && (range.repeat ?? 0) > 0) return;
        pos = (pos + 1) % seq.length;
        frame.current = seq[pos];
        tick();
      }, (sprite.frames[frame.current]?.duration ?? 100) / Math.max(0.1, state.prefs.playSpeed));
    };
    tick();
    return () => clearTimeout(timer);
  }, [playing, tagIndex]);
  return () => playing || tagIndex >= 0 ? Math.min(frame.current, state.sprite.frames.length - 1) : state.sprite.frame;
}

type View = { zoom: number; cx: number; cy: number; };

/** Draws a frame with a camera; zoom 0 means "fit" */
function drawView(can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, frame: number, view: View, background: string | null) {
  const { sprite } = state;
  const k = view.zoom || Math.max(1, Math.floor(Math.min(can.width / sprite.width, can.height / sprite.height)));
  const w = sprite.width * k, h = sprite.height * k;
  const x = Math.round(can.width / 2 - view.cx * k), y = Math.round(can.height / 2 - view.cy * k);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, can.width, can.height);
  const image = sprite.render(frame);
  const tile = (tx: number, ty: number) => {
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(tx, ty, w, h);
    }
    ctx.drawImage(image, tx, ty, w, h);
  };
  // Wrap-around mode repeats the image across the whole view
  if (state.tiledX || state.tiledY) {
    const xs = state.tiledX ? Math.ceil(can.width / w) + 1 : 0, ys = state.tiledY ? Math.ceil(can.height / h) + 1 : 0;
    for (let j = -ys; j <= ys; j++) for (let i = -xs; i <= xs; i++) tile(x + i * w, y + j * h);
  } else tile(x, y);
}

const Window = styled.div`
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background-color: var(--bg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
  resize: both;
  overflow: hidden;
  min-width: 140px;
  min-height: 110px;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  height: var(--row);
  padding: 0 2px 0 6px;
  background-color: var(--face);
  border-bottom: 1px solid var(--b1);
  cursor: move;
  flex-shrink: 0;
`;

const Body = styled.div`
  position: relative;
  flex-grow: 1;
  cursor: grab;
  background:
    repeating-conic-gradient(#0000 0 25%, #0001 0 50%) 0 0 / 16px 16px,
    var(--workspace);
`;

export const PreviewWindow: FC = () => {
  useSignals();
  // Place, size and toggles are remembered in the layout
  const { previewX, previewY, previewW, previewH } = state.layout;
  const playing = state.layout.previewPlaying, follow = state.layout.previewFollow;
  const setPlaying = (v: boolean) => state.setLayout({ previewPlaying: v });
  const setFollow = (v: boolean) => state.setLayout({ previewFollow: v });
  const pos = { x: previewX, y: previewY };
  const setPos = (p: { x: number; y: number; }) => state.setLayout({ previewX: p.x, previewY: p.y });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The window is resizable by its corner; keep the size it was given
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w && h && (w !== state.layout.previewW || h !== state.layout.previewH)) state.setLayout({ previewW: w, previewH: h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.layout.showPreview]);
  const view = useRef<View>({ zoom: 0, cx: 0, cy: 0 });
  const [tagIndex, setTagIndex] = useState(-1);
  const frame = usePreviewFrame(playing, tagIndex < state.sprite.tags.length ? tagIndex : -1);
  if (!state.layout.showPreview) return null;

  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <Window ref={box} style={{ right: pos.x, top: pos.y, width: previewW, height: previewH }}>
      <Title onPointerDown={e => {
        // Anchored to the top-right corner, so dragging right decreases `x`
        const start = pos, cx = e.clientX, cy = e.clientY;
        const move = (ev: PointerEvent) => setPos({ x: Math.max(0, start.x - (ev.clientX - cx)), y: Math.max(0, start.y + ev.clientY - cy) });
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      }}>
        <span style={{ flexGrow: 1 }}>{t('common.preview')}</span>
        {state.sprite.tags.length > 0 && (
          <span onPointerDown={stop}>
            <Select value={tagIndex} title={t('preview.playOnlyThisTag')} onChange={e => setTagIndex(+e.target.value)}>
              <option value={-1}>{t('preview.current')}</option>
              {state.sprite.tags.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
            </Select>
          </span>
        )}
        <Button $square $active={follow} title={t('preview.followTheMainView')} onPointerDown={stop} onClick={() => { setFollow(!follow); view.current.zoom = 0; }}>
          <Icon name="link" scale="glyph" />
        </Button>
        <Button $square $active={playing} title={t('preview.playPause')} onPointerDown={stop} onClick={() => setPlaying(!playing)}>
          <Icon name={playing ? 'pause' : 'play'} scale="glyph" />
        </Button>
        <Button $square title={t('common.close')} onPointerDown={stop} onClick={() => state.setLayout({ showPreview: false })}>
          <Icon name="close" scale="glyph" />
        </Button>
      </Title>
      <Body
        onWheel={e => {
          const v = view.current;
          const base = v.zoom || Math.max(1, Math.floor(Math.min(e.currentTarget.clientWidth / state.sprite.width, e.currentTarget.clientHeight / state.sprite.height)));
          v.zoom = Math.max(1, Math.min(64, base + (e.deltaY < 0 ? 1 : -1)));
          setFollow(false);
        }}
        onPointerDown={e => {
          // Dragging pans the preview on its own and stops following
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = view.current, sx = e.clientX, sy = e.clientY, cx = v.cx, cy = v.cy;
          const k = v.zoom || Math.max(1, Math.floor(Math.min(e.currentTarget.clientWidth / state.sprite.width, e.currentTarget.clientHeight / state.sprite.height)));
          setFollow(false);
          const el = e.currentTarget;
          const move = (ev: PointerEvent) => { v.cx = cx - (ev.clientX - sx) / k; v.cy = cy - (ev.clientY - sy) / k; };
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        }}
      >
        <Canvas inset loop={(can, ctx) => {
          const v = view.current;
          if (follow) {
            // Center of what the main editor shows
            v.cx = state.camX;
            v.cy = state.camY;
          }
          drawView(can, ctx, frame(), v, null);
        }} />
      </Body>
    </Window>
  );
};

const Fullscreen = styled.div`
  position: fixed;
  inset: 0;
  z-index: 950;
  background-color: #000;
  cursor: none;
`;

export const FullscreenPreview: FC = () => {
  useSignals();
  const frame = usePreviewFrame(state.fullscreenPreview, -1);
  const [bg, setBg] = useState(-1);
  const view = useRef<View>({ zoom: 0, cx: 0, cy: 0 });

  useEffect(() => {
    if (!state.fullscreenPreview) return;
    const { sprite } = state;
    view.current = { zoom: Math.max(1, Math.round(state.zoom)), cx: state.camX, cy: state.camY };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // + / - cycle the background: checkerboard, then each palette color
      if (e.key === '+' || e.key === '=') return setBg(b => b + 1 >= state.palette.length ? -1 : b + 1);
      if (e.key === '-') return setBg(b => b - 1 < -1 ? state.palette.length - 1 : b - 1);
      const nav: Record<string, () => void> = {
        ArrowLeft: () => { sprite.frame = (sprite.frame - 1 + sprite.frames.length) % sprite.frames.length; },
        ArrowRight: () => { sprite.frame = (sprite.frame + 1) % sprite.frames.length; },
        Home: () => { sprite.frame = 0; },
        End: () => { sprite.frame = sprite.frames.length - 1; },
      };
      if (nav[e.key]) return nav[e.key]();
      state.fullscreenPreview = false;
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [state.fullscreenPreview]);

  if (!state.fullscreenPreview) return null;
  return createPortal(
    <Fullscreen
      onPointerMove={e => {
        // Moving the mouse pans the image
        const v = view.current;
        v.cx -= e.movementX / (v.zoom || 1);
        v.cy -= e.movementY / (v.zoom || 1);
      }}
      onPointerUp={() => { state.fullscreenPreview = false; }}
      onWheel={e => { view.current.zoom = Math.max(1, Math.min(64, view.current.zoom + (e.deltaY < 0 ? 1 : -1))); }}
    >
      <Canvas inset loop={(can, ctx) => drawView(can, ctx, frame(), view.current, bg >= 0 ? state.palette[bg] : null)} />
    </Fullscreen>,
    document.body
  );
};
