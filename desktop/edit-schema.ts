import * as z from 'zod/v4';

const index = z.number().int().nonnegative();
const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
const rect = z.object({ x: z.number().int().min(-4096).max(4096), y: z.number().int().min(-4096).max(4096), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) });
const userData = z.object({ text: z.string().optional(), color: hex.optional() });
const layer = z.object({
  name: z.string().max(256).optional(), visible: z.boolean().optional(), locked: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.enum(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']).optional(),
  userData: userData.optional(),
});
const tag = z.object({ name: z.string().max(256).optional(), from: index, to: index, color: hex.optional(), direction: z.enum(['forward', 'reverse', 'pingpong', 'pingpong-reverse']).optional(), repeat: index.optional(), userData: userData.optional() });
const slice = z.object({ name: z.string().max(256).optional(), color: hex.optional(), keys: z.array(rect.extend({ frame: index })).max(10000).optional(), userData: userData.optional() });

/** Validate the positional API before opening a document transaction. */
export const editOperation = z.discriminatedUnion('method', [
  z.object({ method: z.literal('sprite.layers.add'), args: z.tuple([layer.extend({ group: z.boolean().optional(), at: index.optional() }).optional()]) }),
  z.object({ method: z.literal('sprite.layers.update'), args: z.tuple([index, layer]) }),
  z.object({ method: z.literal('sprite.layers.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.layers.move'), args: z.tuple([index, index]) }),
  z.object({ method: z.literal('sprite.frames.add'), args: z.tuple([index.optional(), z.object({ copy: z.boolean().optional(), duration: z.number().int().positive().max(3_600_000).optional() }).optional()]) }),
  z.object({ method: z.literal('sprite.frames.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.frames.setDuration'), args: z.tuple([index, z.number().int().positive().max(3_600_000)]) }),
  z.object({ method: z.literal('sprite.frames.move'), args: z.tuple([index, index]) }),
  z.object({ method: z.literal('sprite.tags.add'), args: z.tuple([tag]) }),
  z.object({ method: z.literal('sprite.tags.update'), args: z.tuple([index, tag.partial()]) }),
  z.object({ method: z.literal('sprite.tags.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.slices.add'), args: z.tuple([slice]) }),
  z.object({ method: z.literal('sprite.slices.update'), args: z.tuple([index, slice]) }),
  z.object({ method: z.literal('sprite.slices.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.palette.set'), args: z.tuple([z.array(hex).min(1).max(256), z.object({ keepPixels: z.boolean().optional() }).optional()]) }),
  z.object({ method: z.literal('sprite.selection.set'), args: z.tuple([rect.nullable()]) }),
]);
