/**
 * Function-calling tools offered to the model, each mapped onto ctx.
 * Writes go through `sprite.transaction('AI: …')`, so every AI action is one undo step.
 */
import type { ExtensionContext, PixelData, Rect, SpriteSnapshot, Transaction } from "@pixprite/api";

/** Largest area get_pixels / put_pixels accept in one call (keeps prompts small) */
const MAX_AREA = 64 * 64;

export type ToolResult = { content: string; image?: Blob; };

const hex = (r: number, g: number, b: number, a: number) =>
  a === 0 ? '' : '#' + [r, g, b, ...(a < 255 ? [a] : [])].map(v => v.toString(16).padStart(2, '0')).join('');

function parseHex(s: string | null | undefined): [number, number, number, number] {
  if (!s) return [0, 0, 0, 0];
  const m = s.replace('#', '');
  const full = m.length <= 4 ? [...m].map(c => c + c).join('') : m;
  const n = (i: number, d = 255) => full.length > i ? parseInt(full.slice(i, i + 2), 16) : d;
  return [n(0, 0), n(2, 0), n(4, 0), n(6)];
}

/** The snapshot without per-frame cel lists of every layer, which the model rarely needs */
const brief = (s: SpriteSnapshot) => ({
  name: s.name, width: s.width, height: s.height, colorMode: s.colorMode, palette: s.palette,
  layer: s.layer, frame: s.frame,
  layers: s.layers.map((l, i) => ({ index: i, name: l.name, visible: l.visible, locked: l.locked, group: l.group, opacity: l.opacity, cels: l.cels.map(c => !!c) })),
  frames: s.frames.map(f => f.duration),
  tags: s.tags.map(x => ({ name: x.name, from: x.from, to: x.to, direction: x.direction })),
  slices: s.slices.map(x => x.name),
});

const int = { type: 'integer' } as const;
const str = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

/** OpenAI `tools` array */
export const TOOL_SCHEMAS = [
  { name: 'get_sprite', description: 'Describe the active sprite: size, layers (index, name), frames (durations ms), tags, slices.', parameters: obj({}) },
  { name: 'render_png', description: 'Render a flattened frame as PNG; shown to the user. Returns its size.', parameters: obj({ frame: int, scale: int }, ['frame']) },
  {
    name: 'get_pixels', description: `Read pixels of a cel as rows of hex colors ("" = transparent). At most ${MAX_AREA} pixels per call.`,
    parameters: obj({ layer: int, frame: int, x: int, y: int, w: int, h: int }, ['layer', 'frame']),
  },
  {
    name: 'put_pixels', description: 'Write pixels into a cel. `rows` is an array of h rows, each an array of w hex colors ("#rrggbb", "#rrggbbaa" or "" for transparent).',
    parameters: obj({ layer: int, frame: int, x: int, y: int, rows: { type: 'array', items: { type: 'array', items: str } } }, ['layer', 'frame', 'x', 'y', 'rows']),
  },
  {
    name: 'fill_rect', description: 'Fill a rectangle of a cel with one hex color ("" clears it).',
    parameters: obj({ layer: int, frame: int, x: int, y: int, w: int, h: int, color: str }, ['layer', 'frame', 'x', 'y', 'w', 'h', 'color']),
  },
  {
    name: 'list_commands',
    description: 'List editor commands: id, label and, for those that take arguments, `params` (key, type, range, default). Filter by a word of the id or label.',
    parameters: obj({ filter: str }),
  },
  {
    name: 'run_command',
    description: 'Run an editor command by id; it acts on the active layer, frame and selection. Commands with `params` (effects, canvas and sprite size, color mode, layer and frame properties…) take `args` with those keys; omitted ones use their defaults. Ids with ":" belong to other extensions.',
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

  return {
    async get_sprite() { return json(brief(await ctx.sprite.get())); },

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
      const rows = a.rows as string[][];
      const h = rows.length, w = Math.max(0, ...rows.map(r => r.length));
      if (!w || !h) return json({ error: 'empty rows' });
      if (w * h > MAX_AREA) return json({ error: `area too large, max ${MAX_AREA} pixels` });
      const data = new Uint8ClampedArray(w * h * 4);
      rows.forEach((r, y) => r.forEach((c, x) => data.set(parseHex(c), (y * w + x) * 4)));
      const pixels: PixelData = { rect: { x: a.x, y: a.y, w, h }, format: 'rgba', data };
      await tx(`pixels ${w}×${h}`, t => t.putPixels(a.layer, a.frame, pixels));
      await reveal({ layer: a.layer, frame: a.frame, rect: pixels.rect });
      return json({ ok: true, rect: pixels.rect });
    },

    async fill_rect(a) {
      const rect = { x: a.x, y: a.y, w: Math.max(0, a.w), h: Math.max(0, a.h) };
      if (!rect.w || !rect.h) return json({ error: 'empty rect' });
      const data = new Uint8ClampedArray(rect.w * rect.h * 4);
      const c = parseHex(a.color);
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
