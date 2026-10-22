/**
 * Function-calling tools offered to the model, each mapped onto ctx.
 * Writes go through `sprite.transaction('AI: …')`, so every AI action is one undo step.
 */
import type { ExtensionContext, PixelData, SpriteSnapshot, Transaction } from "@pixprite/api";

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
  name: s.name, width: s.width, height: s.height, colorMode: s.colorMode, palette: s.palette?.slice(0, 64) ?? null,
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
  { name: 'list_commands', description: 'List editor commands (id and label).', parameters: obj({ filter: str }) },
  { name: 'run_command', description: 'Run an editor command by id.', parameters: obj({ id: str }, ['id']) },
  { name: 'add_layer', description: 'Add a layer; returns its index.', parameters: obj({ name: str, at: int }, ['name']) },
  {
    name: 'set_tags', description: 'Add animation tags. With replace=true existing tags are removed first.',
    parameters: obj({
      tags: { type: 'array', items: obj({ name: str, from: int, to: int, color: str }, ['name', 'from', 'to']) },
      replace: { type: 'boolean' },
    }, ['tags']),
  },
].map(f => ({ type: 'function' as const, function: f }));

type Args = Record<string, any>;

export function makeTools(ctx: ExtensionContext): Record<string, (a: Args) => Promise<ToolResult>> {
  const json = (v: unknown): ToolResult => ({ content: JSON.stringify(v) });
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
      return json({ ok: true, rect: pixels.rect });
    },

    async list_commands(a) {
      const f = String(a.filter ?? '').toLowerCase();
      const list = await ctx.commands.list();
      return json(list.filter(c => !f || c.id.toLowerCase().includes(f) || c.label.toLowerCase().includes(f)).slice(0, 200));
    },

    async run_command(a) {
      const result = await tx(String(a.id), () => ctx.commands.run(String(a.id)));
      return json({ ok: true, result: result ?? null });
    },

    async add_layer(a) {
      const index = await tx(`layer ${a.name}`, t => t.layers.add({ name: String(a.name), at: a.at }));
      return json({ ok: true, index });
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
