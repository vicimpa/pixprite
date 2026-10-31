/**
 * Places where extension UI shows up in the editor: docked / floating panels, statusbar and
 * toolbar widgets, menu entries, the tool stroke preview on the canvas and lock notices.
 */

import { t } from "~/core/i18n";
import type { MenuEntry, MenuItems } from "~/ui/Menu";
import { Button } from "~/ui/Button";
import { ExtFrame } from "~/ui/ExtFrame";
import { Icon } from "~/ui/Icon";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FC } from "react";
import styled from "styled-components";
import { activeTab, dockOf, hiddenPanels, selectTab, panelKey, panelLayout, placePanel, setSideSize, sideSize, togglePanel, type Dock, type PanelPlace, type Side } from "~/core/extensions/panels";
import { CloseButton, closeLeft } from "~/ui/Dialog";
import { trackPointer } from "~/ui/trackPointer";
import { Splitter } from "~/ui/Splitter";
import { contributions, extensionsHost } from "./bridge";
import type { PixelData } from "./types";

export { hiddenPanels, togglePanel } from "~/core/extensions/panels";

const PanelBox = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background-color: var(--bg);
  border: 1px solid var(--b1);

  & > iframe { flex: 1 1 auto; width: 100%; min-height: 0; }
`;

const Floating = styled(PanelBox)`
  position: fixed;
  z-index: 700;
  box-shadow: 3px 3px 0 var(--shadow);
`;

/** Edges and corner a floating window is resized by; they lie over the frame so it can't take the pointer */
const Grip = styled.div`
  touch-action: none;
  position: absolute;
  z-index: 1;
  &[data-edge=e] { top: 0; right: -3px; width: 6px; bottom: 6px; cursor: ew-resize; }
  &[data-edge=s] { left: 0; bottom: -3px; height: 6px; right: 6px; cursor: ns-resize; }
  &[data-edge=w] { top: 0; left: -3px; width: 6px; bottom: 6px; cursor: ew-resize; }
  &[data-edge=se] { right: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nwse-resize; }
  &[data-edge=sw] { left: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
`;

const Head = styled.header`
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--row);
  padding: 0 2px 0 6px;
  background-color: var(--face);
  border-bottom: 1px solid var(--b1);
  flex-shrink: 0;
  user-select: none;

  & > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &[data-float=true] { cursor: move; touch-action: none; }
  /* Close button on the left on macOS, as in dialogs */
  &[data-close-left=true] { flex-direction: row-reverse; padding: 0 6px 0 2px; }
`;

/** While a panel is dragged or resized its frame must not swallow the pointer */
const Shield = styled.div`
  position: fixed;
  inset: 0;
  z-index: 10000;
`;

type Panel = ReturnType<typeof contributions<'panels'>>[number];

const MIN_W = 160, MIN_H = 100;
const minW = (p: Panel) => Math.max(MIN_W, p.minWidth ?? 0);
const minH = (p: Panel) => Math.max(MIN_H, p.minHeight ?? 0);

/** Where a panel shows: the user's choice only when the extension lets it be detached */
const placeOf = (p: Panel): Dock => p.detachable ? dockOf(panelKey(p.ext, p.id), p.dock) : p.dock;

/** Title bar: drag to move a floating panel, detach / dock (when allowed), close */
const PanelHead: FC<{ p: Panel; floating: boolean; onDrag?: (e: React.PointerEvent) => void; }> = ({ p, floating, onDrag }) => {
  const host = extensionsHost.value!;
  const key = panelKey(p.ext, p.id);
  // Docking goes back to the declared side; a panel declared floating docks on the right
  const home: Side = p.dock === 'float' ? 'right' : p.dock;
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <Head data-float={floating} data-close-left={closeLeft} onPointerDown={onDrag}>
      <span>{host.label(p.ext, p.label)}</span>
      {p.detachable && <Button $square type="button" title={t(floating ? 'extensions.dockPanel' : 'extensions.detachPanel')} onPointerDown={stop}
        onClick={() => placePanel(key, { dock: floating ? home : 'float' })}>
        <Icon name={floating ? 'dockIn' : 'popout'} scale="glyph" />
      </Button>}
      <CloseButton type="button" title={t('common.close')} onPointerDown={stop} onClick={() => togglePanel(p.ext, p.id)}>
        <Icon name="close" scale="glyph" />
      </CloseButton>
    </Head>
  );
};

/** A panel in its own window: moved by its title bar, resized by its edges; both remembered */
const FloatingPanel: FC<{ p: Panel; }> = ({ p }) => {
  const host = extensionsHost.value!;
  const key = panelKey(p.ext, p.id);
  const place = panelLayout.value.panels[key] ?? {};
  const w = Math.max(minW(p), place.w ?? p.width ?? 260), h = Math.max(minH(p), place.h ?? p.height ?? 280);
  // Kept on screen even when the window got smaller since
  const x = Math.max(0, Math.min(innerWidth - 80, place.x ?? innerWidth - w - 24));
  const y = Math.max(0, Math.min(innerHeight - 40, place.y ?? 80));
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    e.stopPropagation(); setBusy(true); el.style.willChange = 'transform';
    let nextX = x, nextY = y;
    trackPointer(e, (dx, dy) => {
      nextX = Math.max(0, Math.min(innerWidth - 80, Math.round(x + dx)));
      nextY = Math.max(0, Math.min(innerHeight - 40, Math.round(y + dy)));
      el.style.transform = `translate3d(${nextX - x}px, ${nextY - y}px, 0)`;
    }, () => {
      Object.assign(el.style, { left: `${nextX}px`, top: `${nextY}px`, transform: '', willChange: '' });
      placePanel(key, { x: nextX, y: nextY }); setBusy(false);
    });
  };
  const resize = (edge: string) => (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    e.stopPropagation(); setBusy(true);
    let patch: PanelPlace = {};
    trackPointer(e, (dx, dy) => {
      patch = {};
      if (edge.includes('e')) patch.w = Math.max(minW(p), Math.round(w + dx));
      if (edge.includes('w')) { patch.w = Math.max(minW(p), Math.round(w - dx)); patch.x = Math.round(x + w - patch.w); }
      if (edge.includes('s')) patch.h = Math.max(minH(p), Math.round(h + dy));
      if (patch.w !== undefined) el.style.width = `${patch.w}px`;
      if (patch.h !== undefined) el.style.height = `${patch.h}px`;
      if (patch.x !== undefined) el.style.left = `${patch.x}px`;
    }, () => { placePanel(key, patch); setBusy(false); });
  };

  return (
    <>
      {busy && <Shield style={{ cursor: 'grabbing' }} />}
      <Floating ref={box} style={{ left: x, top: y, width: w, height: h }}>
        <PanelHead p={p} floating onDrag={drag} />
        <ExtFrame ext={p.ext} role="panel" contribution={p.id} page={p.page} title={host.label(p.ext, p.label)} />
        {['e', 's', 'w', 'se', 'sw'].map(edge => <Grip key={edge} data-edge={edge} onPointerDown={resize(edge)} />)}
      </Floating>
    </>
  );
};

const Tabs = styled.header`
  display: flex;
  align-items: stretch;
  height: var(--row);
  background-color: var(--face);
  border-bottom: 1px solid var(--b1);
  flex-shrink: 0;
  user-select: none;
  overflow-x: auto;
  scrollbar-width: none;

  & > button[role=tab] {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 8px;
    border: none;
    border-right: 1px solid var(--b1);
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
  }
  & > button[role=tab][aria-selected=true] { background-color: var(--bg); color: var(--fg); }
  &[data-close-left=true] > button[role=tab] { flex-direction: row-reverse; padding: 0 8px 0 4px; }
  & > .gap { flex: 1; }
  & > .tools { display: flex; align-items: center; padding: 0 2px; }
`;

/** Docked panels of one side, as tabs with a splitter to the workspace; or the floating windows (`float`) */
export const ExtPanels: FC<{ dock: Dock; }> = ({ dock }) => {
  useSignals();
  const host = extensionsHost.value;
  const panels = contributions('panels').filter(p => placeOf(p) === dock && !hiddenPanels.value.has(panelKey(p.ext, p.id)));
  if (!host || !panels.length) return null;
  if (dock === 'float') return <>{panels.map(p => <FloatingPanel key={panelKey(p.ext, p.id)} p={p} />)}</>;
  const bottom = dock === 'bottom';
  // The column is never narrower than its widest panel asks
  const least = Math.max(140, ...panels.map(p => bottom ? minH(p) : minW(p)));
  const size = Math.max(least, sideSize(dock));
  const keys = panels.map(p => panelKey(p.ext, p.id));
  const active = activeTab(dock, keys);
  const cur = panels[keys.indexOf(active)];

  const box = (
    <PanelBox style={{ flexShrink: 0, ...(bottom ? { height: size } : { width: size }) }}>
      {panels.length === 1 ? <PanelHead p={cur} floating={false} /> : (
        <Tabs role="tablist" data-close-left={closeLeft}>
          {panels.map((p, i) => (
            <button key={keys[i]} type="button" role="tab" aria-selected={keys[i] === active} onClick={() => selectTab(dock, keys[i])}>
              <span>{host.label(p.ext, p.label)}</span>
              <CloseButton as="span" title={t('common.close')} onClick={e => { e.stopPropagation(); togglePanel(p.ext, p.id); }}>
                <Icon name="close" scale="glyph" />
              </CloseButton>
            </button>
          ))}
          <span className="gap" />
          {cur.detachable && <span className="tools">
            <Button $square type="button" title={t('extensions.detachPanel')} onClick={() => placePanel(active, { dock: 'float' })}>
              <Icon name="popout" scale="glyph" />
            </Button>
          </span>}
        </Tabs>
      )}
      {/* Every tab keeps its page loaded; only the open one is shown */}
      {panels.map((p, i) => (
        <ExtFrame key={keys[i]} ext={p.ext} role="panel" contribution={p.id} page={p.page} title={host.label(p.ext, p.label)}
          style={keys[i] === active ? undefined : { display: 'none' }} />
      ))}
    </PanelBox>
  );
  // The splitter sits between the panels and the workspace
  const split = <Splitter vertical={!bottom} value={size} dir={dock === 'left' ? 1 : -1} min={least} max={bottom ? 600 : 900} onChange={v => setSideSize(dock, v)} />;
  return dock === 'left' ? <>{box}{split}</> : <>{split}{box}</>;
};

export const ExtWidgets: FC<{ slot: 'statusbar' | 'toolbar'; }> = ({ slot }) => {
  useSignals();
  const widgets = contributions('widgets').filter(w => w.slot === slot);
  if (!widgets.length) return null;
  const size = slot === 'statusbar' ? { width: 120, height: 'calc(var(--row) - 2px)' } : { width: '100%', height: 48 };
  return <>
    {widgets.map(w => <ExtFrame key={`${w.ext}/${w.id}`} ext={w.ext} role="widget" contribution={w.id} page={w.page} style={size} />)}
  </>;
};

/** Menu entries extensions add to `location` (a context menu or a main menu id) */
export function extensionMenuItems(location: string): MenuItems {
  const host = extensionsHost.value;
  if (!host) return [];
  const commands = contributions('commands');
  const items: MenuEntry[] = [
    ...contributions('menus').filter(m => m.location === location).map(m => `${m.ext}:${m.command}`),
    ...commands.filter(c => c.menu === location).map(c => `${c.ext}:${c.id}`),
  ].filter((id, i, all) => all.indexOf(id) === i).map(id => {
    const c = commands.find(c => `${c.ext}:${c.id}` === id);
    return { label: c ? host.label(c.ext, c.label) : id, run: () => host.runCommand(id) };
  });
  return items.length ? ['-', ...items] : [];
}

export function extensionPanelItems(): MenuItems {
  const host = extensionsHost.value;
  if (!host) return [];
  return contributions('panels').map(p => ({
    label: host.label(p.ext, p.label),
    checked: !hiddenPanels.value.has(panelKey(p.ext, p.id)),
    run: () => togglePanel(p.ext, p.id),
  }));
}

let cached: { data: PixelData; canvas: HTMLCanvasElement; } | null = null;

function overlayCanvas(data: PixelData) {
  if (cached?.data === data) return cached.canvas;
  const { w, h } = data.rect;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  if (data.format === 'rgba' && w && h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    rgba.set(data.data.subarray(0, rgba.length));
    canvas.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
  }
  cached = { data, canvas };
  return canvas;
}

/** Draws the extension tool's stroke preview; called by the canvas view every frame */
export function drawExtensionOverlay(ctx: CanvasRenderingContext2D, ox: number, oy: number, zoom: number) {
  const data = extensionsHost.peek()?.overlay.peek();
  if (!data || !data.rect.w || !data.rect.h) return;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overlayCanvas(data), ox + data.rect.x * zoom, oy + data.rect.y * zoom, data.rect.w * zoom, data.rect.h * zoom);
  ctx.imageSmoothingEnabled = smooth;
}

/** Outlines places shown with `view.reveal`, fading out; called by the canvas view every frame */
export function drawExtensionHighlights(ctx: CanvasRenderingContext2D, ox: number, oy: number, zoom: number) {
  const list = extensionsHost.peek()?.highlights.peek();
  if (!list?.length) return;
  const now = performance.now();
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f0b24a';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const { rect, until } of list) {
    const left = until - now;
    if (left <= 0) continue;
    // Fully visible most of the time, fades out over the last 400 ms
    const a = Math.min(1, left / 400);
    const x = Math.round(ox + rect.x * zoom), y = Math.round(oy + rect.y * zoom);
    const w = Math.round(rect.w * zoom), h = Math.round(rect.h * zoom);
    ctx.globalAlpha = a * 0.18;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = a;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }
  ctx.restore();
}

const Toast = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(var(--row) * 2 + 8px);
  transform: translateX(-50%);
  z-index: 850;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100vw - 32px));
  padding: 6px 8px 6px 10px;
  color: var(--tooltip-fg);
  background: var(--tooltip);
  border: 1px solid var(--b1);
  box-shadow: 2px 2px 0 var(--shadow);
  white-space: normal;
`;

/** Refused structural changes and the "unlock?" offer for locks of a missing extension */
export const ExtensionNotices: FC = () => {
  useSignals();
  const host = extensionsHost.value;
  const notice = host?.lockedNotice.value ?? null;
  const orphan = host?.orphanLocks.value ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const id = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  const orphanKey = orphan && `${orphan.document}/${orphan.owner}`;
  return <>
    {orphan && orphanKey !== dismissed && (
      <Toast>
        <span>{t('extensions.orphanLocks', { owner: orphan.owner })}</span>
        <Button type="button" onClick={() => { host!.unlockOrphan(); setDismissed(orphanKey); }}>{t('extensions.unlock')}</Button>
        <Button type="button" onClick={() => setDismissed(orphanKey)}>{t('extensions.keepLocks')}</Button>
      </Toast>
    )}
    {shown && !orphan && <Toast style={{ pointerEvents: 'none' }}><span>{shown}</span></Toast>}
  </>;
};

