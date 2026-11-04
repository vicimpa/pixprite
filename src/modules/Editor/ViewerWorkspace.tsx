import { useSignals } from '@preact/signals-react/runtime';
import { useEffect, useRef, useState } from 'react';
import { activeViewer, closeViewer, viewerTabs } from '~/core/ViewerTabs';
import { state } from '~/core/State';
import { t } from '~/core/i18n';
import { Button } from '~/ui/Button';

/** Images have their own camera and never enter the editable Sprite model. */
export function ViewerWorkspace() {
  useSignals();
  const tab = viewerTabs.value.find(tab => tab.id === activeViewer.value);
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<HTMLImageElement | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const draw = () => {
    const element = canvas.current, bitmap = image.current;
    if (!element || !tab) return;
    const box = element.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    element.width = Math.round(box.width * ratio); element.height = Math.round(box.height * ratio);
    const ctx = element.getContext('2d')!;
    ctx.scale(ratio, ratio); ctx.imageSmoothingEnabled = false;
    const size = Math.max(4, state.prefs.checkerSize);
    for (let y = 0; y < box.height; y += size) for (let x = 0; x < box.width; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2) ? state.prefs.checkerA : state.prefs.checkerB;
      ctx.fillRect(x, y, size, size);
    }
    if (bitmap) ctx.drawImage(bitmap, box.width / 2 + view.x - tab.width * view.zoom / 2, box.height / 2 + view.y - tab.height * view.zoom / 2, tab.width * view.zoom, tab.height * view.zoom);
  };
  const fit = () => {
    const box = canvas.current?.getBoundingClientRect();
    if (box && tab) setView({ zoom: Math.max(0.125, Math.min(16, (box.width - 40) / tab.width, (box.height - 40) / tab.height)), x: 0, y: 0 });
  };
  useEffect(() => {
    if (!tab) return;
    image.current = null;
    const bitmap = new Image();
    bitmap.onload = () => { image.current = bitmap; fit(); };
    bitmap.src = `data:image/png;base64,${tab.image}`;
    return () => { bitmap.onload = null; };
  }, [tab?.id]);
  useEffect(draw, [tab, view, state.prefs.checkerA, state.prefs.checkerB, state.prefs.checkerSize]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(draw); observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [view, tab]);
  if (!tab) return null;
  return <section data-testid="comparison-viewer" style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8 }}>
      <span style={{ flex: 1 }}>{tab.name} · {tab.width}×{tab.height} · {Math.round(view.zoom * 100)}%</span>
      <Button onClick={fit}>{t('cmd.view.fit')}</Button><Button onClick={() => closeViewer(tab.id)}>{t('common.close')}</Button>
    </header>
    <canvas ref={canvas} aria-label={tab.name} style={{ flex: '1 1 0', minHeight: 0, width: '100%', cursor: 'grab', touchAction: 'none' }}
      onWheel={event => { setView(v => ({ ...v, zoom: Math.max(0.125, Math.min(128, v.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2))) })); }}
      onPointerDown={event => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setView(v => ({ ...v, x: v.x + event.movementX, y: v.y + event.movementY })); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    <footer style={{ padding: 8, maxHeight: '20%', overflow: 'auto' }}>{tab.items.map((item, index) => <span key={index} style={{ display: 'inline-block', marginRight: 16 }}>{index + 1}. {item.name} · {item.frame + 1} · r{item.revision}</span>)}</footer>
  </section>;
}
