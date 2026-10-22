import { Color } from "~/core/Color";
import { state } from "~/core/State";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FC } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

const Swatch = styled.button`
  width: 40px;
  height: var(--row);
  padding: 2px;
  border: 1px solid var(--b1);
  background: var(--face);
  cursor: pointer;

  & > span { display: block; width: 100%; height: 100%; border: 1px solid rgba(0, 0, 0, .35); }
`;

const Pop = styled.div`
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 200px;
  padding: 6px;
  background: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

const Field = styled.div`
  position: relative;
  height: 120px;
  cursor: crosshair;
  touch-action: none;
  border: 1px solid var(--b1);
`;

const Strip = styled.div`
  position: relative;
  height: 12px;
  cursor: ew-resize;
  touch-action: none;
  border: 1px solid var(--b1);
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
`;

const Marker = styled.div`
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -4px 0 0 -4px;
  border: 1px solid #fff;
  outline: 1px solid #000;
  pointer-events: none;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, 14px);
  gap: 2px;
  max-height: 64px;
  overflow-y: auto;

  & > button { width: 14px; height: 14px; padding: 0; border: 1px solid var(--b1); cursor: pointer; }
`;

const Hex = styled.input`
  font: inherit;
  height: var(--row);
  padding: 0 4px;
  color: var(--fg);
  background: var(--field);
  border: 1px solid var(--b1);
  user-select: text;
`;

/** Drag inside an element: reports the pointer as 0..1 in x and y */
function drag(e: React.PointerEvent<HTMLElement>, fn: (x: number, y: number) => void) {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const at = (ev: { clientX: number; clientY: number; }) => {
    const r = el.getBoundingClientRect();
    fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
  };
  at(e);
  const move = (ev: PointerEvent) => at(ev);
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}

/** Color field drawn by the app: a swatch that opens a picker (HSV field, hue strip, palette, hex) */
export const ColorInput: FC<{ value: string; onChange: (hex: string) => void; title?: string; }> = ({ value, onChange, title }) => {
  useSignals();
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<CSSProperties>({});
  const [hsv, setHsv] = useState(() => Color.fromHex(value).hsv);
  const [hexText, setHexText] = useState(value);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;

  useEffect(() => { if (!open) { setHsv(Color.fromHex(value).hsv); setHexText(value); } }, [value, open]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const down = innerHeight - r.bottom > 280;
    setBox({ left: Math.max(4, Math.min(r.left, innerWidth - 210)), ...(down ? { top: r.bottom + 2 } : { bottom: innerHeight - r.top + 2 }) });
    const outside = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('pointerdown', outside, true); removeEventListener('keydown', esc, true); };
  }, [open]);

  const apply = (nh: number, ns: number, nv: number) => {
    setHsv([nh, ns, nv]);
    const hex = Color.fromHsv(nh, ns, nv).toHexString(false);
    setHexText(hex);
    onChange(hex);
  };

  return <>
    <Swatch ref={btn} type="button" title={title} onClick={() => setOpen(!open)}><span style={{ background: value }} /></Swatch>
    {open && createPortal(
      <Pop ref={pop} style={box} onKeyDown={e => e.stopPropagation()}>
        <Field
          style={{ background: `linear-gradient(transparent, #000), linear-gradient(90deg, #fff, hsl(${h}, 100%, 50%))` }}
          onPointerDown={e => drag(e, (x, y) => apply(h, x, 1 - y))}>
          <Marker style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
        </Field>
        <Strip onPointerDown={e => drag(e, x => apply(x * 360, s, v))}>
          <Marker style={{ left: `${h / 360 * 100}%`, top: '50%' }} />
        </Strip>
        <Grid>
          {state.palette.map((c, i) => (
            <button key={i} type="button" title={c} style={{ background: c }}
              onClick={() => { const hv = Color.fromHex(c).hsv; apply(hv[0], hv[1], hv[2]); }} />
          ))}
        </Grid>
        <Hex value={hexText} spellCheck={false}
          onChange={e => {
            setHexText(e.target.value);
            const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(e.target.value.trim());
            if (m) { const c = Color.fromHex(`#${m[1]}`); setHsv(c.hsv); onChange(c.toHexString(false)); }
          }} />
      </Pop>,
      document.body
    )}
  </>;
};
