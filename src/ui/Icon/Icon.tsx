import { memo, type FC } from "react";
import { ICONS, type IconName } from "./icons";
import { useSignals } from "@preact/signals-react/runtime";
import { iconArtwork, resolveIconPack, selectedIconPack } from "~/core/IconPacks";

const FILLS: Record<string, string> = {
  '#': 'currentColor',
  'o': 'var(--icon-fill)',
  '+': 'var(--accent)',
};

type Run = { x: number; y: number; w: number; c: string; };

const parsed = new Map<string, { w: number; h: number; runs: Run[]; }>();

/** Turns an ASCII grid into horizontal runs of same-colored pixels */
function parse(pixels: string) {
  const cached = parsed.get(pixels);
  if (cached) return cached;
  const rows = pixels.trim().split('\n').map(r => r.trim());
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
  if (parsed.size > 256) parsed.clear();
  parsed.set(pixels, result);
  return result;
}

export type IconProps = {
  name: IconName;
  /** 'tool' for toolbar-sized icons, 'glyph' for small inline ones, or a fixed pixel scale */
  scale?: 'tool' | 'glyph' | number;
};

export const Icon: FC<IconProps> = memo(({ name, scale = 'tool' }) => {
  useSignals();
  const artwork = iconArtwork(selectedIconPack.value, name);
  const vector = artwork && 'paths' in artwork ? artwork : null;
  const builtin = parse(ICONS[name] ?? ICONS.square);
  const pixel = artwork && 'pixels' in artwork ? parse(artwork.pixels) : vector ? null : builtin;
  const { w, h } = builtin;
  const color = (c: string | undefined, fallback: string) => c === 'foreground' ? 'currentColor' : c === 'accent' ? 'var(--accent)' : c === 'fill' ? 'var(--icon-fill)' : c ?? fallback;
  return (
    <svg
      viewBox={pixel ? `0 0 ${pixel.w} ${pixel.h}` : `0 0 ${vector!.size} ${vector!.size}`}
      shapeRendering={pixel ? 'crispEdges' : 'geometricPrecision'}
      aria-hidden="true" focusable="false" data-icon={name} data-icon-style={pixel ? 'pixel' : 'vector'}
      data-icon-pack={resolveIconPack(selectedIconPack.value)}
      style={{
        display: 'block',
        flexShrink: 0,
        width: typeof scale === 'number' ? w * scale : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${w}px)`,
        height: typeof scale === 'number' ? h * scale : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${h}px)`,
      }}
    >
      {pixel ? pixel.runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={FILLS[r.c]} />
      )) : vector?.paths.map((p, i) => <path key={i} d={p.d}
        fill={color(p.fill, 'none')} stroke={color(p.stroke, 'currentColor')} strokeWidth={p.strokeWidth ?? 1.75}
        strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
});
