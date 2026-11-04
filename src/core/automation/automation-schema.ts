import * as z from 'zod/v4-mini';

export const index = z.int().check(z.minimum(0));
const dimension = z.int().check(z.minimum(1), z.maximum(4096));
const coordinate = z.int().check(z.minimum(-4096), z.maximum(4096));
const opacity = z.number().check(z.minimum(0), z.maximum(1));
export const target = {
  contextId: z.optional(z.string().check(z.maxLength(128))),
  follow: z.optional(z.boolean()),
  documentId: z.optional(z.string().check(z.meta({ description: 'Stable target document ID. Resolves background documents independently of the visible tab.' }))),
  expectedRevision: z.optional(index.check(z.meta({ description: 'Exact document revision from inspect or the previous edit. A mismatch fails before any change.' }))),
};
export const rect = z.object({ x: index, y: index, w: dimension, h: dimension });
export const pixelOperation = z.object({
  action: z.enum(['read', 'write', 'fill']), layer: z.optional(index), frame: z.optional(index), rect: z.optional(rect),
  data: z.optional(z.string().check(z.maxLength(6_000_000))), fill: z.optional(z.string().check(z.regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/))),
  rows: z.optional(z.array(z.array(z.string().check(z.regex(/^(|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8}))$/i))).check(z.minLength(1), z.maxLength(4096))).check(z.minLength(1), z.maxLength(4096))),
  encoding: z.optional(z.enum(['base64', 'hex'])),
});
export const viewOptions = {
  frame: z.optional(index), layer: z.optional(index), zoom: z.optional(z.number().check(z.minimum(0.25), z.maximum(128))),
  center: z.optional(z.boolean()), fit: z.optional(z.boolean()),
  pan: z.optional(z.object({ x: z.number().check(z.minimum(-1_000_000), z.maximum(1_000_000)), y: z.number().check(z.minimum(-1_000_000), z.maximum(1_000_000)) })),
  onion: z.optional(z.object({ enabled: z.boolean(), before: z.optional(index.check(z.maximum(16))), after: z.optional(index.check(z.maximum(16))), opacity: z.optional(opacity) })),
};
export const comparisonItem = z.object({
  documentId: z.string(), expectedRevision: z.optional(index), frame: index, layer: z.optional(index),
  reference: z.optional(z.object({ documentId: z.string(), expectedRevision: z.optional(index), frame: index, layer: z.optional(index), opacity: z._default(opacity, 0.5), x: z._default(coordinate, 0), y: z._default(coordinate, 0) })),
});
export const comparisonOptions = z.object({
  title: z._default(z.string().check(z.maxLength(256)), 'Comparison'),
  items: z.array(comparisonItem).check(z.minLength(1), z.maxLength(128)), columns: z._default(z.int().check(z.minimum(1), z.maximum(32)), 4),
  scale: z._default(z.int().check(z.minimum(1), z.maximum(16)), 1), show: z._default(z.boolean(), true),
  guides: z._default(z.array(z.object({ axis: z.enum(['x', 'y']), pos: index.check(z.maximum(4096)) })).check(z.maxLength(32)), []),
});
