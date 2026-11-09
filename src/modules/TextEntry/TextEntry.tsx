import { Color } from "~/core/Color";
import type { Bitmap } from "~/core/Image";
import { state, TEXT_FONTS } from "~/core/State";
import { t } from "~/core/i18n";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import styled from "styled-components";

/** Renders text with the text tool's options; hard-edged unless antialiasing is on */
export function textBitmap(text: string, color: Color, font: string, size: number, antialias: boolean): Bitmap | null {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  probe.font = font;
  const metrics = lines.map(line => probe.measureText(line));
  // Logical advances preserve leading/trailing spaces; ink bounds retain italic overhangs.
  const left = Math.ceil(Math.max(0, ...metrics.map(m => m.actualBoundingBoxLeft))) + 1;
  const w = Math.max(1, left + Math.ceil(Math.max(...metrics.map(m => Math.max(m.width, m.actualBoundingBoxRight)))) + 1);
  const ascent = Math.ceil(Math.max(size, ...metrics.map(m => m.fontBoundingBoxAscent || m.actualBoundingBoxAscent)));
  const descent = Math.ceil(Math.max(size / 4, ...metrics.map(m => m.fontBoundingBoxDescent || m.actualBoundingBoxDescent)));
  const lineHeight = ascent + descent;
  const h = Math.max(1, lineHeight * lines.length + 2);
  const can = new OffscreenCanvas(w, h);
  const ctx = can.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => ctx.fillText(line, left, ascent + 1 + i * lineHeight));
  const src = ctx.getImageData(0, 0, w, h).data;
  const [r, g, b, a] = color.rgba;
  const data = new Uint32Array(w * h);
  for (let i = 0; i < data.length; i++) {
    const cover = src[i * 4 + 3] / 255;
    const alpha = antialias ? cover : cover >= 0.5 ? 1 : 0;
    if (alpha) data[i] = ((Math.round(a * alpha * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return { w, h, data };
}

const Input = styled.textarea`
  position: absolute;
  z-index: 5;
  min-width: 4px;
  padding: 0;
  box-sizing: border-box;
  resize: none;
  overflow: hidden;
  white-space: pre;
  pointer-events: none;
  border: none;
  outline: 1px dashed var(--accent);
  background: transparent;
  /* The canvas shows the real pixels; the field only provides the caret */
  color: transparent;
  caret-color: var(--accent);
`;

export const TextEntry: FC = () => {
  useSignals();
  const ref = useRef<HTMLTextAreaElement>(null);
  const at = state.textAt;
  const [draft, setDraft] = useState<{ at: typeof at; text: string }>({ at: null, text: '' });
  const text = draft.at === at ? draft.text : '';
  const { sprite, colorA: color, textSize: size, textAntialias: antialias } = state;
  const family = TEXT_FONTS[state.textFont] ?? 'sans-serif';
  const style = `${state.textItalic ? 'italic ' : ''}${state.textBold ? 'bold ' : ''}`;
  const font = `${style}${size}px ${family}`;
  const current = useRef({ at, text, sprite, color, font, size, antialias });
  current.current = { at, text, sprite, color, font, size, antialias };
  // All exit paths (Enter, another box, another tool) flush the same draft.
  // If options change while a font loads, render the latest snapshot instead.
  useLayoutEffect(() => {
    const update = (draft: typeof current.current) => {
      if (!draft.at || state.textAt !== draft.at || state.sprite !== draft.sprite) return;
      const bmp = textBitmap(draft.text, draft.color, draft.font, draft.size, draft.antialias);
      if (!bmp) { if (draft.sprite.floating) draft.sprite.cancelFloating(); return; }
      if (draft.sprite.floating) draft.sprite.replaceFloating(bmp);
      else draft.sprite.paste(bmp, draft.at, 'Text');
    };
    const prepare = (): void | Promise<void> => {
      const draft = current.current;
      if (!draft.text) return update(draft);
      // FontFaceSet.check can report ready while WebKit is still fetching the
      // selected face. load also resolves immediately for an already loaded face.
      return document.fonts.load(draft.font, draft.text).catch(() => []).then(() => {
        if (state.textAt !== draft.at || state.sprite !== draft.sprite) return;
        if (current.current !== draft) return prepare();
        update(draft);
      });
    };
    state.prepareText = prepare;
    return () => { if (state.prepareText === prepare) state.prepareText = null; };
  }, []);
  useEffect(() => {
    if (!at) return;
    ref.current?.focus();
    const focus = (event: globalThis.PointerEvent) => {
      if ((event.target as Element).closest('[data-testid="sprite-canvas"]')) ref.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerup', focus);
    return () => document.removeEventListener('pointerup', focus);
  }, [at]);
  // Switching tools applies the text
  const tool = state.tool;
  useEffect(() => { if (tool !== 'text') void state.finishText(true); }, [tool]);
  useEffect(() => {
    if (!at) return;
    let cancelled = false;
    const update = () => {
      if (cancelled || state.textAt !== at || state.sprite !== sprite) return;
      const bmp = textBitmap(text, color, font, size, antialias);
      if (!bmp) { if (sprite.floating) sprite.cancelFloating(); return; }
      if (sprite.floating) sprite.replaceFloating(bmp);
      else sprite.paste(bmp, at, 'Text');
    };
    if (!text) update();
    else void document.fonts.load(font, text).then(update, update);
    return () => { cancelled = true; };
  }, [text, at, sprite, color, font, size, antialias]);
  if (!at) return null;
  const close = (apply: boolean) => { void state.finishText(apply); };

  // Follows the live floating text (it may be dragged), else the click point
  const f = sprite.floating;
  const x = f ? f.place.x : at.x, y = f ? f.place.y : at.y;
  return (
    <Input
      ref={ref}
      data-testid="text-entry"
      aria-label={t('text.entry')}
      title={t('text.help')}
      value={text}
      wrap="off"
      spellCheck={false}
      style={{
        left: state.offsetX + x * state.zoomX,
        top: state.offsetY + y * state.zoomY,
        width: Math.max(8, (f ? Math.abs(f.place.w) : 4) * state.zoomY),
        height: (f ? Math.abs(f.place.h) : state.textSize) * state.zoomY,
        font: `${style}${size * state.zoomY}px ${family}`,
        lineHeight: `${(f ? (f.src.h - 2) / text.split('\n').length : size * 1.25) * state.zoomY}px`,
        padding: state.zoomY,
        transform: `scaleX(${sprite.pixelRatioX / sprite.pixelRatioY})`, transformOrigin: 'top left',
      }}
      onChange={e => setDraft({ at, text: e.target.value })}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(true); }
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
      }}
      />
  );
};
