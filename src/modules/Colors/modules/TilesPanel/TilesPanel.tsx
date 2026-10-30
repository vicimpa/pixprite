import { t } from "~/core/i18n";
import { runCommand } from "~/core/Commands";
import { exportTilemap, exportTileset, importTilesetImage } from "~/core/Files";
import { state } from "~/core/State";
import { FLIP_D, FLIP_X, FLIP_Y, flagsOf, rotateRef, tileOf, type TilesetMode } from "~/core/Tilemap";
import { Button, Muted } from "~/ui/Button";
import { openContextMenu } from "~/ui/Menu";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, type FC } from "react";
import styled from "styled-components";
import { useViewport } from "~/ui/useViewport";
import { visibleRange } from "~/ui/virtualGeometry";

const Box = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 40%;
  min-height: 80px;
  padding: 4px;
  border-top: 1px solid var(--b1);
`;

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
`;

const Grid = styled.div`
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
`;

const MODES: [TilesetMode, string, string][] = [
  ['manual', 'Manual', 'Painting edits the tiles in place (everywhere they are used); never adds tiles'],
  ['auto', 'Auto', 'Keeps the tileset minimal: reuses identical tiles, edits unshared ones, adds the rest, drops unused'],
  ['stack', 'Stack', 'Never changes existing tiles: every new look becomes a new tile'],
];

const CELL = 26;

/** Tile number with its flips, e.g. 4xy */
const tileName = (ref: number) => `${tileOf(ref)}${ref & FLIP_X ? 'x' : ''}${ref & FLIP_Y ? 'y' : ''}${ref & FLIP_D ? 'd' : ''}`;

/** Tileset of the active tilemap layer: pick tiles for the left / right button */
export const TilesPanel: FC = () => {
  useSignals();
  const { sprite } = state;
  const ts = sprite.tileset;
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const viewport = useViewport(holder);
  const cols = Math.max(1, Math.floor((viewport.width - 4) / CELL));
  const rows = Math.ceil((ts?.tiles.length ?? 0) / cols);
  const window = visibleRange(rows, CELL, viewport.top, viewport.height);
  const first = window.start * cols, last = Math.min(ts?.tiles.length ?? 0, window.end * cols);
  void sprite.version;

  useEffect(() => {
    const can = ref.current;
    if (!can || !ts) return;

    can.width = cols * CELL;
    can.height = (window.end - window.start) * CELL;
    const ctx = can.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, can.width, can.height);
    const tmp = new OffscreenCanvas(ts.tw, ts.th);
    const tctx = tmp.getContext('2d')!;
    const use = sprite.tileUsage();
    const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#e2574c';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    for (let i = first; i < last; i++) {
      const tile = ts.tiles[i];
      const x = (i % cols) * CELL, y = (Math.floor(i / cols) - window.start) * CELL;
      ctx.fillStyle = (Math.floor(i / cols) + i % cols) % 2 ? state.prefs.checkerA : state.prefs.checkerB;
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      tctx.putImageData(new ImageData(new Uint8ClampedArray(tile.slice().buffer), ts.tw, ts.th), 0, 0);
      const k = (CELL - 4) / Math.max(ts.tw, ts.th);
      ctx.drawImage(tmp, x + 2 + ((CELL - 4) - ts.tw * k) / 2, y + 2 + ((CELL - 4) - ts.th * k) / 2, ts.tw * k, ts.th * k);
      if (i > 0) {
        // How many cells use the tile; unused ones are marked red
        const n = use[i] ?? 0, label = n > 99 ? '99+' : `${n}`;
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(x + CELL - 2 - label.length * 5 - 2, y + CELL - 11, label.length * 5 + 2, 9);
        ctx.fillStyle = n ? '#fff' : danger;
        ctx.fillText(label, x + CELL - 3, y + CELL - 4);
      }
      if (i === 0) {
        // The empty tile
        ctx.strokeStyle = danger;
        ctx.beginPath(); ctx.moveTo(x + 4, y + CELL - 4); ctx.lineTo(x + CELL - 4, y + 4); ctx.stroke();
      }
      if (i === tileOf(state.tileA) || i === tileOf(state.tileB)) {
        ctx.strokeStyle = i === tileOf(state.tileA) ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.lineWidth = 1;
      }
    }
  });

  if (!ts) return null;
  /** Tile index under a pointer, or -1 */
  const at = (e: { clientX: number; clientY: number; }) => {
    const el = holder.current!, r = el.getBoundingClientRect();
    const x = e.clientX - r.left + el.scrollLeft, y = e.clientY - r.top + el.scrollTop;
    if (e.clientX < r.left || e.clientY < r.top || e.clientX >= r.left + el.clientWidth || e.clientY >= r.top + el.clientHeight || x >= cols * CELL) return -1;
    const i = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
    return i < ts.tiles.length ? i : -1;
  };
  const pick = (e: React.MouseEvent<HTMLCanvasElement>, secondary: boolean) => {
    e.preventDefault();
    const i = at(e);
    if (i < 0 || i >= ts.tiles.length) return;
    // Picking keeps the flips set for that button
    if (secondary) state.tileB = (i | flagsOf(state.tileB)) >>> 0; else state.tileA = (i | flagsOf(state.tileA)) >>> 0;
    // Picking a tile means placing tiles
    state.tilemapMode = 'tiles';
  };

  return (
    <Box>
      <Bar>
        <Button $active={state.tilemapMode === 'pixels'} onClick={() => { state.tilemapMode = 'pixels'; }} title={t('tiles.paintPixelsTheyAre')}>{t('tiles.pixels')}</Button>
        <Button $active={state.tilemapMode === 'tiles'} onClick={() => { state.tilemapMode = 'tiles'; }} title={t('tiles.placeWholeTilesPencil')}>{t('common.tiles')}</Button>
        <span style={{ flexGrow: 1 }} />
        {MODES.map(([m, l, t]) => (
          <Button key={m} $active={sprite.tilesetMode === m} title={t} onClick={() => { sprite.tilesetMode = m; state.tilemapMode = 'pixels'; }}>{l}</Button>
        ))}
      </Bar>
      <Bar>
        <Muted>{ts.name} · {ts.tw}×{ts.th} · {ts.tiles.length - 1} tiles · left {tileName(state.tileA)}, right {tileName(state.tileB)}</Muted>
        <span style={{ flexGrow: 1 }} />
        <Button title={t('tiles.importExportTheTileset')} onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          openContextMenu([
            { label: t('tiles.importTilesFromImage'), run: () => void importTilesetImage() },
            { label: t('tiles.exportTilesetAsPng'), disabled: ts.tiles.length < 2, run: () => void exportTileset() },
            { label: t('tiles.exportMapAsJson'), run: () => void exportTilemap('json') },
            { label: t('tiles.exportMapAsCsv'), run: () => void exportTilemap('csv') },
            '-',
            { label: t('tiles.removeUnusedTiles'), disabled: ts.tiles.length < 2, run: () => runCommand('tiles.removeUnused') },
            { label: t('tiles.mergeDuplicateTiles'), disabled: ts.tiles.length < 3, run: () => runCommand('tiles.mergeDuplicates') },
            { label: t('tiles.changeTileset'), disabled: sprite.tilesets.length < 2, run: () => runCommand('layer.changeTileset') },
          ], r.left, r.bottom);
        }}>⋯</Button>
        <Button $active={!!(state.tileA & FLIP_X)} title={t('tiles.mirrorTheLeftButton')} onClick={() => { state.tileA = (state.tileA ^ FLIP_X) >>> 0; }}>⇋</Button>
        <Button $active={!!(state.tileA & FLIP_Y)} title={t('tiles.mirrorTheLeftButtonTile')} onClick={() => { state.tileA = (state.tileA ^ FLIP_Y) >>> 0; }}>⇵</Button>
        <Button $active={!!(state.tileA & FLIP_D)} title={t('tiles.turnTheLeftButton')} onClick={() => { state.tileA = rotateRef(state.tileA); }} disabled={ts.tw !== ts.th}>⟳</Button>
      </Bar>
      <Grid ref={holder}>
        <div style={{ position: 'relative', height: rows * CELL, width: cols * CELL }}>
        <canvas ref={ref} aria-label={t('common.tiles')} style={{ display: 'block', cursor: 'pointer', position: 'absolute', top: window.start * CELL }}
          onPointerDown={e => {
            // Dragging a tile to another slot reorders the tileset
            if (e.button !== 0) return;
            const from = at(e);
            if (from < 1) return;
            const up = (ev: PointerEvent) => {
              removeEventListener('pointerup', up);
              const to = at(ev);
              if (to >= 0 && to !== from) { sprite.moveTile(from, to); state.tileA = to; state.save(); }
            };
            addEventListener('pointerup', up);
          }}
          onClick={e => pick(e, false)}
          onContextMenu={e => {
            e.preventDefault();
            const i = at(e);
            if (i < 0) return;
            openContextMenu([
              { label: t('tiles.useForTheRight'), run: () => { state.tileB = i; state.tilemapMode = 'tiles'; } },
              { label: t('tiles.duplicateTile'), disabled: i === 0, run: () => { sprite.duplicateTile(i); state.save(); } },
              { label: t('tiles.deleteTile'), disabled: i === 0, run: () => { sprite.deleteTiles([i]); state.save(); } },
            ], e.clientX, e.clientY);
          }} />
        </div>
      </Grid>
    </Box>
  );
};
