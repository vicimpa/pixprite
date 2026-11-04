import * as z from 'zod/v4-mini';
import type { ExportOptions } from './Files';
import type { Sprite } from './Sprite';

const index = z.int().check(z.minimum(0));
const flag = z.optional(z.boolean());
const sheet = z.object({
  type: z.enum(['horizontal', 'vertical', 'rows', 'columns', 'packed']), count: index,
  splitLayers: z.boolean(), splitTags: z.boolean(), border: index, spacing: index, inner: index,
  trim: z.enum(['none', 'sprite', 'cels']), trimByGrid: z.boolean(), extrude: z.boolean(),
  mergeDuplicates: z.boolean(), ignoreEmpty: z.boolean(), powerOfTwo: z.boolean(), template: z.string(),
});
const options = z.object({
  kind: z.enum(['png', 'sheet', 'gif', 'apng', 'webm', 'frames', 'zip', 'ico', 'cur']),
  scale: z.number().check(z.minimum(1), z.maximum(64)),
  tag: z.optional(z.int().check(z.minimum(-1))), layer: z.optional(index),
  currentLayer: flag, trim: flag, loop: flag, applyPixelRatio: flag,
  area: z.optional(z.union([z.object({ kind: z.literal('selection') }), z.object({ kind: z.literal('slice'), index })])),
  split: z.optional(z.enum(['none', 'layers', 'selectedLayers', 'tags', 'slices'])),
  sheet: z.optional(sheet), json: z.optional(z.enum(['none', 'hash', 'array'])),
  icoSizes: z.optional(z.array(z.int().check(z.minimum(1), z.maximum(256))).check(z.maxLength(256))),
});
const settings = z.object({
  options, tagName: z.optional(z.string()), layerName: z.optional(z.string()), sliceName: z.optional(z.string()),
});
export type LastExport = z.infer<typeof settings>;
type Target = Pick<Sprite, 'tags' | 'layers' | 'slices' | 'range' | 'mask'>;

/** Stored preferences are untrusted; discard malformed records rather than executing them. */
export function readLastExport(value: unknown): LastExport | null {
  const result = z.safeParse(settings, value);
  if (!result.success || result.data.options.kind === 'sheet' && !result.data.options.sheet) return null;
  return result.data;
}

export function captureLastExport(doc: Target, opts: ExportOptions): LastExport {
  return {
    options: z.parse(options, opts),
    ...(opts.tag !== undefined && opts.tag >= 0 ? { tagName: doc.tags[opts.tag]?.name } : {}),
    ...(opts.layer !== undefined ? { layerName: doc.layers[opts.layer]?.name } : {}),
    ...(opts.area?.kind === 'slice' ? { sliceName: doc.slices[opts.area.index]?.name } : {}),
  };
}

/** A deleted/replaced target opens the export dialog; never silently export a different range. */
export function lastExportOptions(doc: Target, last: LastExport | null): ExportOptions | null {
  if (!last) return null;
  const opts = last.options;
  if (opts.tag !== undefined && (opts.tag === -1 ? !doc.range : !last.tagName || doc.tags[opts.tag]?.name !== last.tagName)) return null;
  if (opts.layer !== undefined && (!last.layerName || doc.layers[opts.layer]?.name !== last.layerName)) return null;
  if (opts.area?.kind === 'slice' && (!last.sliceName || doc.slices[opts.area.index]?.name !== last.sliceName)) return null;
  if (opts.area?.kind === 'selection' && !doc.mask?.bounds) return null;
  return structuredClone(opts);
}
