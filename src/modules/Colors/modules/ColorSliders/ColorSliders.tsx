import { Color } from "~/core/Color";
import { state } from "~/core/State";
import { Input } from "~/ui/Button";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";

const Root = styled.div`
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg2);
  border: 1px solid var(--b1);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const Name = styled.span`
  width: 1.2em;
  color: var(--fg-dim);
`;

const Track = styled.input.attrs({ type: 'range' })`
  appearance: none;
  flex-grow: 1;
  height: 12px;
  border: 1px solid var(--b1);
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 6px;
    height: 14px;
    background: #fff;
    border: 1px solid #000;
  }
`;

const Num = styled(Input)`
  width: 3.4em;
`;

const checker = 'repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 8px 8px';

/** RGB / HSV / alpha sliders and a hex field; tracks show the gradient for the current color */
export const ColorSliders: FC<{ alt: boolean; }> = ({ alt }) => {
  useSignals();
  const color = alt ? state.colorB : state.colorA;
  const set = (c: Color) => { if (alt) state.colorB = c; else state.colorA = c; };
  const [r, g, b, a] = color.rgba;
  const [h, s, v] = color.hsv;
  const [hex, setHex] = useState(color.toHexString(false));
  const [typing, setTyping] = useState(false);
  // The hex field follows the color unless it is being typed into
  useEffect(() => { if (!typing) setHex(color.toHexString(false)); }, [color, typing]);

  const rgbTrack = (k: 0 | 1 | 2) => {
    const lo = [r, g, b], hi = [r, g, b];
    lo[k] = 0; hi[k] = 255;
    return `linear-gradient(to right, rgb(${lo}), rgb(${hi}))`;
  };
  const hsvColor = (hh: number, ss: number, vv: number) => Color.fromHsv(hh, ss, vv).toHexString(false);
  const rows: [string, number, number, string, (n: number) => void][] = [
    ['R', r, 255, rgbTrack(0), n => set(Color.fromRgb(n, g, b, a))],
    ['G', g, 255, rgbTrack(1), n => set(Color.fromRgb(r, n, b, a))],
    ['B', b, 255, rgbTrack(2), n => set(Color.fromRgb(r, g, n, a))],
    ['H', Math.round(h), 360, `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(d => hsvColor(d, s || 1, v || 1)).join(',')})`, n => set(Color.fromHsv(n, s, v, a))],
    ['S', Math.round(s * 100), 100, `linear-gradient(to right, ${hsvColor(h, 0, v)}, ${hsvColor(h, 1, v)})`, n => set(Color.fromHsv(h, n / 100, v, a))],
    ['V', Math.round(v * 100), 100, `linear-gradient(to right, #000, ${hsvColor(h, s, 1)})`, n => set(Color.fromHsv(h, s, n / 100, a))],
    ['A', Math.round(a * 255), 255, `linear-gradient(to right, transparent, rgb(${r},${g},${b})), ${checker}`, n => set(Color.fromRgb(r, g, b, n / 255))],
  ];

  return (
    <Root>
      {rows.map(([name, value, max, track, onChange]) => (
        <Row key={name}>
          <Name>{name}</Name>
          <Track min={0} max={max} value={value} style={{ background: track }} onChange={e => onChange(+e.target.value)} />
          <Num type="number" min={0} max={max} value={value} onChange={e => onChange(Math.max(0, Math.min(max, +e.target.value || 0)))} />
        </Row>
      ))}
      <Row>
        <Name>#</Name>
        <Input
          value={hex.replace('#', '')}
          style={{ flexGrow: 1 }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => {
            const raw = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 8);
            setHex('#' + raw);
            // Short input is padded so the color updates while typing
            if (raw.length >= 3) {
              try { set(Color.fromHex(raw.length === 3 || raw.length === 6 || raw.length === 8 ? raw : raw.padEnd(6, '0'))); } catch { }
            }
          }} />
      </Row>
    </Root>
  );
};
