import * as z from 'zod/v4-mini';
import { editMethods } from './methods';

const index = z.int().check(z.minimum(0));
const hex = z.string().check(z.regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i));
const coordinate = z.int().check(z.minimum(-4096), z.maximum(4096));
const dimension = z.int().check(z.minimum(1), z.maximum(4096));
const duration = z.int().check(z.gt(0), z.maximum(3_600_000));
const name = z.optional(z.string().check(z.maxLength(256)));
const rect = z.object({ x: coordinate, y: coordinate, w: dimension, h: dimension });
const userData = z.object({ text: z.optional(z.string()), color: z.optional(hex) });
const layer = z.object({
  name, visible: z.optional(z.boolean()), locked: z.optional(z.boolean()),
  opacity: z.optional(z.number().check(z.minimum(0), z.maximum(1))),
  blend: z.optional(z.enum(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'])),
  userData: z.optional(userData),
});
const tag = z.object({ name, from: index, to: index, color: z.optional(hex), direction: z.optional(z.enum(['forward', 'reverse', 'pingpong', 'pingpong-reverse'])), repeat: z.optional(index), userData: z.optional(userData) });
const slice = z.object({ name, color: z.optional(hex), keys: z.optional(z.array(z.extend(rect, { frame: index })).check(z.maxLength(10000))), userData: z.optional(userData) });

/** Validate the positional API before opening a document transaction. */
export const editOperation = z.discriminatedUnion('method', [
  z.object({ method: z.literal('sprite.layers.add'), args: z.tuple([z.optional(z.extend(layer, { group: z.optional(z.boolean()), at: z.optional(index) }))]) }),
  z.object({ method: z.literal('sprite.layers.update'), args: z.tuple([index, layer]) }),
  z.object({ method: z.literal('sprite.layers.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.layers.move'), args: z.tuple([index, index]) }),
  z.object({ method: z.literal('sprite.frames.add'), args: z.tuple([z.optional(index), z.optional(z.object({ copy: z.optional(z.boolean()), duration: z.optional(duration) }))]) }),
  z.object({ method: z.literal('sprite.frames.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.frames.setDuration'), args: z.tuple([index, duration]) }),
  z.object({ method: z.literal('sprite.frames.move'), args: z.tuple([index, index]) }),
  z.object({ method: z.literal('sprite.tags.add'), args: z.tuple([tag]) }),
  z.object({ method: z.literal('sprite.tags.update'), args: z.tuple([index, z.partial(tag)]) }),
  z.object({ method: z.literal('sprite.tags.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.slices.add'), args: z.tuple([slice]) }),
  z.object({ method: z.literal('sprite.slices.update'), args: z.tuple([index, slice]) }),
  z.object({ method: z.literal('sprite.slices.remove'), args: z.tuple([index]) }),
  z.object({ method: z.literal('sprite.palette.set'), args: z.tuple([z.array(hex).check(z.minLength(1), z.maxLength(256)), z.optional(z.object({ keepPixels: z.optional(z.boolean()) }))]) }),
  z.object({ method: z.literal('sprite.selection.set'), args: z.tuple([z.nullable(rect)]) }),
]);

// Some MCP clients discard JSON Schema prefixItems and misreport tuple args as string[].
// Publish ordinary heterogeneous array items; retain positional validation in the editor.
export const editOperationInput = z.object({
  method: z.enum(editMethods),
  args: z.array(z.union([index, z.string(), z.boolean(), z.null(), z.array(z.string()), z.looseObject({})])).check(z.maxLength(3)),
});
