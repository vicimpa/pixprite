import { Color } from "~/core/Color";
import type { Bitmap } from "~/core/Image";
import { state, TEXT_FONTS } from "~/core/State";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, type FC } from "react";
import styled from "styled-components";

/** Renders text with the text tool's options; hard-edged unless antialiasing is on */
export function textBitmap(text: string, color: Color): Bitmap | null {
  if (!text) return null;
  const font = `${state.textItalic ? 'italic ' : ''}${state.textBold ? 'bold ' : ''}${state.textSize}px ${TEXT_FONTS[state.textFont] ?? 'sans-serif'}`;
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  probe.font = font;
  const m = probe.measureText(text);
  const w = Math.max(1, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 2);
  const ascent = Math.ceil(m.fontBoundingBoxAscent || state.textSize);
  const h = Math.max(1, ascent + Math.ceil(m.fontBoundingBoxDescent || state.textSize / 4));
  const can = new OffscreenCanvas(w, h);
  const ctx = can.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, Math.ceil(m.actualBoundingBoxLeft) + 1, ascent);
  const src = ctx.getImageData(0, 0, w, h).data;
  const [r, g, b, a] = color.rgba;
  const data = new Uint32Array(w * h);
  for (let i = 0; i < data.length; i++) {
    const cover = src[i * 4 + 3] / 255;
    const alpha = state.textAntialias ? cover : cover >= 0.5 ? 1 : 0;
    if (alpha) data[i] = ((Math.round(a * alpha * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return { w, h, data };
}

const Input = styled.input`
  position: absolute;
  z-index: 5;
  min-width: 4px;
  padding: 0;
  border: none;
  outline: 1px dashed var(--accent);
  background: transparent;
  /* The canvas shows the real pixels; the field only provides the caret */
  color: transparent;
  caret-color: var(--accent);
  font-family: inherit;
`;

export const TextEntry: FC = () => {
  useSignals();
  const ref = useRef<HTMLInputElement>(null);
  const at = state.textAt;
  useEffect(() => { ref.current?.focus(); }, [at]);
  // Switching tools applies the text
  const tool = state.tool;
  useEffect(() => { if (tool !== 'text') state.finishText(true); }, [tool]);
  if (!at) return null;
  const { sprite } = state;

  const update = (text: string) => {
    const bmp = textBitmap(text, state.colorA);
    if (!bmp) return;
    if (sprite.floating) sprite.replaceFloating(bmp);
    else sprite.paste(bmp, { x: at.x, y: at.y - Math.round(bmp.h * 0.75) }, 'Text');
  };
  const close = (apply: boolean) => state.finishText(apply);

  // Follows the live floating text (it may be dragged), else the click point
  const f = sprite.floating;
  const x = f ? f.place.x : at.x, y = f ? f.place.y : at.y - state.textSize * 0.75;
  return (
    <Input
      ref={ref}
      style={{
        left: state.offsetX + x * state.zoom,
        top: state.offsetY + y * state.zoom,
        width: Math.max(8, (f ? Math.abs(f.place.w) : 4) * state.zoom),
        height: (f ? Math.abs(f.place.h) : state.textSize) * state.zoom,
        fontSize: state.textSize * state.zoom * 0.8,
      }}
      onChange={e => update(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') close(true);
        if (e.key === 'Escape') close(false);
      }}
      // Clicks on the canvas (moving the text) take focus away; keep typing in the box
      onBlur={e => { const el = e.currentTarget; setTimeout(() => { if (state.textAt) el.focus(); }); }} />
  );
};
