/**
 * Function-calling tools offered to the model, each mapped onto ctx.
 * Writes go through `sprite.transaction('AI: …')`, so every AI action is one undo step.
 */
import type { ExtensionContext, PixelData, Rect, SpriteSnapshot, Transaction } from "@pixprite/api";
import { readSkill, SKILLS } from './skills';

/** Largest area get_pixels / put_pixels accept in one call (keeps prompts small) */
const MAX_AREA = 64 * 64;

export type ToolResult = { content: string; image?: Blob; };

const hex = (r: number, g: number, b: number, a: number) =>
  a === 0 ? '' : '#' + [r, g, b, ...(a < 255 ? [a] : [])].map(v => v.toString(16).padStart(2, '0')).join('');

function parseHex(s: unknown): [number, number, number, number] {
  if (s === '') return [0, 0, 0, 0];
  if (typeof s !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(s)) {
    throw new Error('Color must be #RGB, #RGBA, #RRGGBB, #RRGGBBAA, or "" for transparent');
  }
  const m = s.slice(1);
  const full = m.length <= 4 ? [...m].map(c => c + c).join('') : m;
  const n = (i: number, d = 255) => full.length > i ? parseInt(full.slice(i, i + 2), 16) : d;
  return [n(0, 0), n(2, 0), n(4, 0), n(6)];
}

/** The snapshot without per-frame cel lists of every layer, which the model rarely needs */
const brief = (s: SpriteSnapshot) => ({
  id: s.id, name: s.name, width: s.width, height: s.height, colorMode: s.colorMode, palette: s.palette, transparentIndex: s.transparentIndex,
  layer: s.layer, frame: s.frame,
  layers: s.layers.map((l, i) => ({ index: i, name: l.name, visible: l.visible, locked: l.locked, group: l.group, reference: l.reference, opacity: l.opacity, cels: l.cels.map(c => !!c) })),
  frames: s.frames.map(f => f.duration),
  tags: s.tags.map(x => ({ name: x.name, from: x.from, to: x.to, direction: x.direction, repeat: x.repeat })),
  slices: s.slices.map(x => x.name),
});

const int = { type: 'integer' } as const;
const str = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

/** OpenAI `tools` array */
export const TOOL_SCHEMAS = [
  { name: 'read_skill', description: 'Load a built-in task skill before inspecting or editing the sprite. The system message lists when each skill applies.', parameters: obj({ name: { type: 'string', enum: SKILLS.map(skill => skill.name) } }, ['name']) },
  { name: 'get_sprite', description: 'Describe the active sprite: size, layers (index, name), frames (durations ms), tags, slices.', parameters: obj({}) },
  { name: 'get_selection', description: 'Inspect selection bounds and selected pixel count. Includes a 0/1 mask for selections up to 4096 pixels. Direct pixel writes ignore this mask; editor commands use it.', parameters: obj({}) },
  { name: 'render_png', description: 'Show a flattened PNG to the user. Returns metadata only to the model, not image content. Use get_pixels to inspect colors.', parameters: obj({ frame: int, scale: int }, ['frame']) },
  {
    name: 'get_pixels', description: `Read pixels of a cel as rows of hex colors ("" = transparent). At most ${MAX_AREA} pixels per call.`,
    parameters: obj({ layer: int, frame: int, x: int, y: int, w: int, h: int }, ['layer', 'frame']),
  },
  {
    name: 'put_pixels', description: 'Overwrite a cel rectangle, ignoring selection. At most 4096 pixels. rows must have equal width; every cell is a hex color or "" to ERASE, not skip.',
    parameters: obj({ layer: int, frame: int, x: int, y: int, rows: { type: 'array', items: { type: 'array', items: str } } }, ['layer', 'frame', 'x', 'y', 'rows']),
  },
  {
    name: 'fill_rect', description: 'Overwrite a cel rectangle within canvas bounds with one hex color ("" erases it). Ignores selection; x/y/w/h must be integers.',
    parameters: obj({ layer: int, frame: int, x: int, y: int, w: int, h: int, color: str }, ['layer', 'frame', 'x', 'y', 'w', 'h', 'color']),
  },
  {
    name: 'list_commands',
    description: 'List editor commands: id, label and, for those that take arguments, `params` (key, type, range, default). Filter by a word of the id or label.',
    parameters: obj({ filter: str }),
  },
  {
    name: 'run_command',
    description: 'Run an id discovered by list_commands on the ACTIVE layer/frame/selection. Inspect params first: omitted built-in args apply DEFAULTS immediately, without opening a dialog. Pass args with the exact discovered keys/types. Ids with ":" belong to other extensions.',
    parameters: obj({ id: str, args: { type: 'object', additionalProperties: true } }, ['id']),
  },
  {
    name: 'set_palette',
    description: 'Replace the palette with hex colors (1..256), e.g. to build a palette for the drawing. In the indexed color mode pixels follow their entries; keepPixels=true keeps their colors (for reordering).',
    parameters: obj({ colors: { type: 'array', items: str }, keepPixels: { type: 'boolean' } }, ['colors']),
  },
  { name: 'add_layer', description: 'Add a layer; returns its index.', parameters: obj({ name: str, at: int }, ['name']) },
  {
    name: 'update_layer', description: 'Change a layer: name, visibility, lock, opacity (0..255).',
    parameters: obj({ layer: int, name: str, visible: { type: 'boolean' }, locked: { type: 'boolean' }, opacity: int }, ['layer']),
  },
  { name: 'remove_layer', description: 'Remove a layer.', parameters: obj({ layer: int }, ['layer']) },
  {
    name: 'add_frame', description: 'Insert a frame (by default after the last one); copy=true duplicates the previous frame. Returns its index.',
    parameters: obj({ at: int, duration: int, copy: { type: 'boolean' } }),
  },
  { name: 'remove_frame', description: 'Remove a frame.', parameters: obj({ frame: int }, ['frame']) },
  { name: 'set_frame_duration', description: 'Set how long a frame is shown, in ms.', parameters: obj({ frame: int, duration: int }, ['frame', 'duration']) },
  {
    name: 'set_tags', description: 'Add animation tags. With replace=true existing tags are removed first.',
    parameters: obj({
      tags: { type: 'array', items: obj({ name: str, from: int, to: int, color: str }, ['name', 'from', 'to']) },
      replace: { type: 'boolean' },
    }, ['tags']),
  },
].map(f => ({ type: 'function' as const, function: f }));

type Args = Record<string, any>;

/** `follow`: after a change, switch to its layer / frame and show the changed pixels */
export function makeTools(ctx: ExtensionContext, follow: () => boolean): Record<string, (a: Args) => Promise<ToolResult>> {
  const json = (v: unknown): ToolResult => ({ content: JSON.stringify(v) });
  // Showing is a courtesy: a failure here must not turn a done change into an error for the model
  const reveal = (target: { layer?: number; frame?: number; rect?: Rect; }) =>
    follow() ? ctx.view.reveal({ ...target, highlight: !!target.rect }).catch(() => { }) : undefined;
  const tx = <T>(label: string, fn: (t: Transaction) => Promise<T>) => ctx.sprite.transaction(`AI: ${label}`, fn);
  const checkRect = async (rect: Rect) => {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isSafeInteger) || rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1) {
      throw new Error('Rectangle needs integer x/y >= 0 and positive integer w/h');
    }
    const sprite = await ctx.sprite.get();
    if (rect.x + rect.w > sprite.width || rect.y + rect.h > sprite.height) throw new Error(`Rectangle is outside the ${sprite.width}×${sprite.height} canvas`);
  };

  return {
    async read_skill(a) { return json(readSkill(a.name)); },
    async get_sprite() { return json(brief(await ctx.sprite.get())); },

    async get_selection() {
      const { bounds, mask } = await ctx.sprite.selection.get();
      if (!bounds) return json({ bounds: null, selectedPixels: 0, rectangular: false, maskRows: null });
      const area = bounds.w * bounds.h;
      let selectedPixels = 0;
      if (mask) { for (const pixel of mask) if (pixel) selectedPixels++; }
      else selectedPixels = area;
      const maskRows = area <= MAX_AREA ? Array.from({ length: bounds.h }, (_, y) =>
        Array.from({ length: bounds.w }, (_, x) => !mask || mask[y * bounds.w + x] ? 1 : 0)) : null;
      return json({ bounds, selectedPixels, rectangular: selectedPixels === area, maskRows });
    },

    async render_png(a) {
      const scale = Math.min(8, Math.max(1, a.scale ?? 1));
      const image = await ctx.sprite.render(a.frame ?? 0, { format: 'png', scale });
      return { content: JSON.stringify({ ok: true, bytes: image.size, scale }), image };
    },

    async get_pixels(a) {
      const s = await ctx.sprite.get();
      const rect = { x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? s.width, h: a.h ?? s.height };
      if (rect.w * rect.h > MAX_AREA) return json({ error: `area too large, max ${MAX_AREA} pixels` });
      const p = await ctx.sprite.getPixels(a.layer, a.frame, rect, 'rgba');
      const rows: string[][] = [];
      for (let y = 0; y < p.rect.h; y++) {
        const row: string[] = [];
        for (let x = 0; x < p.rect.w; x++) {
          const i = (y * p.rect.w + x) * 4;
          row.push(hex(p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]));
        }
        rows.push(row);
      }
      return json({ rect: p.rect, rows });
    },

    async put_pixels(a) {
      const rows = a.rows as unknown;
      if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0]) || !rows[0].length) throw new Error('rows must be a non-empty rectangular array of colors');
      const h = rows.length, w = rows[0].length;
      if (!rows.every(row => Array.isArray(row) && row.length === w)) throw new Error('All rows must have the same width; empty strings erase pixels rather than skip them');
      if (w * h > MAX_AREA) return json({ error: `area too large, max ${MAX_AREA} pixels` });
      await checkRect({ x: a.x, y: a.y, w, h });
      const data = new Uint8ClampedArray(w * h * 4);
      (rows as unknown[][]).forEach((r, y) => r.forEach((c, x) => data.set(parseHex(c), (y * w + x) * 4)));
      const pixels: PixelData = { rect: { x: a.x, y: a.y, w, h }, format: 'rgba', data };
      await tx(`pixels ${w}×${h}`, t => t.putPixels(a.layer, a.frame, pixels));
      await reveal({ layer: a.layer, frame: a.frame, rect: pixels.rect });
      return json({ ok: true, rect: pixels.rect });
    },

    async fill_rect(a) {
      const rect = { x: a.x, y: a.y, w: a.w, h: a.h };
      await checkRect(rect);
      const c = parseHex(a.color);
      const data = new Uint8ClampedArray(rect.w * rect.h * 4);
      for (let i = 0; i < data.length; i += 4) data.set(c, i);
      await tx(`fill ${rect.w}×${rect.h}`, t => t.putPixels(a.layer, a.frame, { rect, format: 'rgba', data }));
      await reveal({ layer: a.layer, frame: a.frame, rect });
      return json({ ok: true, rect });
    },

    async list_commands(a) {
      const f = String(a.filter ?? '').toLowerCase();
      const list = await ctx.commands.list();
      return json(list.filter(c => !f || c.id.toLowerCase().includes(f) || c.label.toLowerCase().includes(f)).slice(0, 200));
    },

    async run_command(a) {
      const id = String(a.id);
      // Built-ins always get arguments, so one with a dialog applies its defaults instead of opening it
      const args = a.args ?? (id.includes(':') ? undefined : {});
      // Not in a transaction: commands make their own undo steps (and `undo` itself must not be wrapped)
      const result = await (args === undefined ? ctx.commands.run(id) : ctx.commands.run(id, args));
      return json({ ok: true, result: result ?? null });
    },

    async set_palette(a) {
      await ctx.sprite.palette.set((a.colors as unknown[]).map(String), { keepPixels: !!a.keepPixels });
      return json({ ok: true, count: a.colors.length });
    },

    async add_layer(a) {
      const index = await tx(`layer ${a.name}`, t => t.layers.add({ name: String(a.name), at: a.at }));
      await reveal({ layer: index });
      return json({ ok: true, index });
    },

    async update_layer(a) {
      const patch = Object.fromEntries((['name', 'visible', 'locked', 'opacity'] as const).filter(k => a[k] !== undefined).map(k => [k, a[k]]));
      await tx('layer', t => t.layers.update(a.layer, patch));
      await reveal({ layer: a.layer });
      return json({ ok: true });
    },

    async remove_layer(a) {
      await tx('remove layer', t => t.layers.remove(a.layer));
      return json({ ok: true });
    },

    async add_frame(a) {
      const index = await tx('frame', t => t.frames.add(a.at, { duration: a.duration, copy: a.copy }));
      await reveal({ frame: index });
      return json({ ok: true, index });
    },

    async remove_frame(a) {
      await tx('remove frame', t => t.frames.remove(a.frame));
      return json({ ok: true });
    },

    async set_frame_duration(a) {
      await tx('frame duration', t => t.frames.setDuration(a.frame, a.duration));
      await reveal({ frame: a.frame });
      return json({ ok: true });
    },

    async set_tags(a) {
      const s = await ctx.sprite.get();
      await tx('tags', async t => {
        if (a.replace) for (let i = s.tags.length - 1; i >= 0; i--) await t.tags.remove(i);
        for (const tag of a.tags ?? []) await t.tags.add({ name: tag.name, from: tag.from, to: tag.to, ...(tag.color ? { color: tag.color } : {}) });
      });
      return json({ ok: true });
    },
  };
}
