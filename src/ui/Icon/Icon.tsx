import { memo, type FC } from "react";
import { ICONS, type IconName } from "./icons";

const FILLS: Record<string, string> = {
  '#': 'currentColor',
  'o': 'var(--icon-fill)',
  '+': 'var(--accent)',
};

type Run = { x: number; y: number; w: number; c: string; };

const parsed = new Map<IconName, { w: number; h: number; runs: Run[]; }>();

/** Turns an ASCII grid into horizontal runs of same-colored pixels */
function parse(name: IconName) {
  const cached = parsed.get(name);
  if (cached) return cached;
  const rows = ICONS[name].trim().split('\n').map(r => r.trim());
  const w = Math.max(...rows.map(r => r.length));
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (!FILLS[c]) { x++; continue; }
      let len = 1;
      while (row[x + len] === c) len++;
      runs.push({ x, y, w: len, c });
      x += len;
    }
  });
  const result = { w, h: rows.length, runs };
  parsed.set(name, result);
  return result;
}

export type IconProps = {
  name: IconName;
  /** 'tool' for toolbar-sized icons, 'glyph' for small inline ones, or a fixed pixel scale */
  scale?: 'tool' | 'glyph' | number;
};

export const Icon: FC<IconProps> = memo(({ name, scale = 'tool' }) => {
  const { w, h, runs } = parse(name);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      style={{
        display: 'block',
        flexShrink: 0,
        width: typeof scale === 'number' ? w * scale : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${w}px)`,
        height: typeof scale === 'number' ? h * scale : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${h}px)`,
      }}
    >
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={FILLS[r.c]} />
      ))}
    </svg>
  );
});
