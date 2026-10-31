import type { IconArtwork, IconColor, IconPath } from '@pixprite/api';

export const MAX_ICON_PACK_BYTES = 256 * 1024;
const colors = new Set<IconColor>(['foreground', 'accent', 'fill', 'none']);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: object, keys: string[]) => Object.keys(v).every(k => keys.includes(k));

/** Restrict artwork to inert, bounded geometry. Never insert extension SVG/HTML into the document. */
export function parseIconPack(data: unknown): Record<string, IconArtwork> {
  if (!object(data) || !Object.keys(data).length || Object.keys(data).length > 256) throw new Error('Icon pack: expected 1..256 icons');
  const result: Record<string, IconArtwork> = Object.create(null);
  for (const [name, art] of Object.entries(data)) {
    function fail(): never { throw new Error(`Icon pack: invalid artwork for ${name}`); }
    if (!/^[a-zA-Z][\w.:-]{0,95}$/.test(name) || !object(art)) fail();
    if ('pixels' in art) {
      if (!only(art, ['pixels']) || typeof art.pixels !== 'string' || art.pixels.length > 8192) fail();
      const rows = art.pixels.trim().split('\n').map(row => row.trim());
      const width = rows[0].length;
      if (!width || width > 64 || rows.length > 64 || rows.some(row => row.length !== width || !/^[.#o+]+$/.test(row))) fail();
      result[name] = { pixels: rows.join('\n') };
    } else {
      if (!only(art, ['size', 'paths']) || typeof art.size !== 'number' || !Number.isFinite(art.size) || art.size < 1 || art.size > 128
        || !Array.isArray(art.paths) || !art.paths.length || art.paths.length > 64) fail();
      const paths: IconPath[] = [];
      for (const p of art.paths) {
        if (!object(p) || !only(p, ['d', 'fill', 'stroke', 'strokeWidth']) || typeof p.d !== 'string' || !p.d.length || p.d.length > 4096
          || !/^\s*[Mm][MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]+$/.test(p.d)) fail();
        if ([...p.d.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)].some(m => !Number.isFinite(+m[0]) || Math.abs(+m[0]) > 10_000)) fail();
        for (const key of ['fill', 'stroke'] as const) if (p[key] !== undefined && !colors.has(p[key] as IconColor)) fail();
        if (p.strokeWidth !== undefined && (typeof p.strokeWidth !== 'number' || !Number.isFinite(p.strokeWidth) || p.strokeWidth <= 0 || p.strokeWidth > 16)) fail();
        paths.push({ d: p.d, fill: p.fill as IconColor | undefined, stroke: p.stroke as IconColor | undefined, strokeWidth: p.strokeWidth as number | undefined });
      }
      result[name] = { size: art.size, paths };
    }
  }
  return result;
}
