/**
 * Game rig: maps the sprite's tags to a game character's states and directions, keeps those tags from being
 * broken (locks + validator), plays the character in a preview window and exports a sprite sheet
 * with a rig.json for game engines. The settings live in the "Game rig" panel.
 */
import { defineExtension, type Problem, type SpriteSnapshot } from "@pixprite/api";
import { altRow, colliderAt, dirsOf, isBuiltin, loadRig, sliceKey, type Rig } from "./rig";
import { zip } from "./zip";

const SPRITE = { kind: 'sprite' } as const;

export default defineExtension(ctx => {
  const { t } = ctx.i18n;
  const getRig = async (s: SpriteSnapshot) => loadRig(await ctx.meta.get<Rig>(SPRITE, 'rig'), s);

  ctx.commands.register('settings', () => ctx.ui.panels.show('settings'));
  ctx.commands.register('preview', () => ctx.ui.panels.show('preview'));

  ctx.commands.register('unlock', async () => {
    const locks = await ctx.locks.get();
    if (locks?.owner !== ctx.id) return ctx.ui.notify(t('notLocked'), 'info');
    await ctx.locks.clear();
    const s = await ctx.sprite.get().catch(() => null);
    if (s) await ctx.meta.set(SPRITE, 'rig', { ...await getRig(s), lock: false });
    await ctx.ui.notify(t('unlocked'), 'success');
  });

  ctx.validators.register('rig', async s => {
    const stored = await ctx.meta.get<Rig>(SPRITE, 'rig');
    if (!stored) return [];
    const rig = loadRig(stored, s);
    const problems: Problem[] = [];
    const dirs = dirsOf(rig.directions);
    for (const st of rig.states) {
      const name = isBuiltin(st.id) ? t(`state.${st.id}`) : st.name ?? st.id;
      const empty: string[] = [];
      for (const d of dirs) {
        const tag = rig.cells[st.id]?.[d]?.tag;
        if (tag && !s.tags.some(x => x.name === tag)) problems.push({ severity: 'error', message: t('problem.missingTag', { state: name, dir: t(`dir.${d}`), name: tag }) });
        if (!tag) empty.push(t(`dir.${d}`));
      }
      // The alternative variant may stay empty (the usual tags stand in), but its tags must exist
      if (st.alt.on) for (const d of dirs) {
        const tag = rig.cells[altRow(st.id)]?.[d]?.tag;
        if (tag && !s.tags.some(x => x.name === tag)) problems.push({ severity: 'error', message: t('problem.missingTag', { state: `${name} (${st.alt.name})`, dir: t(`dir.${d}`), name: tag }) });
      }
      if (empty.length === dirs.length) problems.push({ severity: 'warning', message: t('problem.noTags', { state: name }) });
      else if (empty.length) problems.push({ severity: 'info', message: t('problem.someDirs', { state: name, dirs: empty.join(' ') }) });
    }
    for (let f = 0; f < s.frames.length; f++) {
      const c = colliderAt(rig, s, f);
      if (c.w < 1 || c.h < 1 || c.x < 0 || c.y < 0 || c.x + c.w > s.width || c.y + c.h > s.height) {
        problems.push({ severity: 'warning', message: t('problem.collider'), at: { frame: f } });
        break;
      }
    }
    if (rig.collider.slice && !s.slices.some(x => x.name === rig.collider.slice))
      problems.push({ severity: 'error', message: t('problem.missingSlice', { name: rig.collider.slice }) });
    return problems;
  });

  ctx.io.registerExporter('rig', async s => ({ name: `${s.name.replace(/\.\w+$/, '') || 'sprite'}.zip`, data: await exportRig(s) }));

  ctx.commands.register('export', async () => {
    const s = await ctx.sprite.get().catch(() => null);
    if (!s) return ctx.ui.notify(t('noSprite'), 'warning');
    // The core export dialog lists our exporter; without that support say where to find it
    await ctx.commands.run('file.export').catch(() => { });
    await ctx.ui.notify(t('export.hint'), 'info');
  });

  async function exportRig(s: SpriteSnapshot) {
    const rig = await getRig(s);
    const progress = await ctx.ui.progress(t('export.progress'));
    try {
      const n = s.frames.length;
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const sheet = new OffscreenCanvas(cols * s.width, rows * s.height);
      const g = sheet.getContext('2d')!;
      const frames = [];
      for (let f = 0; f < n; f++) {
        const x = (f % cols) * s.width, y = Math.floor(f / cols) * s.height;
        const img = await ctx.sprite.render(f);
        g.drawImage(img, x, y);
        img.close();
        frames.push({ x, y, w: s.width, h: s.height, duration: s.frames[f].duration, collider: colliderAt(rig, s, f) });
        await progress.update((f + 1) / n);
      }
      const json = {
        image: 'sheet.png',
        size: { w: sheet.width, h: sheet.height },
        frame: { w: s.width, h: s.height },
        movement: rig.movement,
        directions: dirsOf(rig.directions),
        frames,
        animations: Object.fromEntries(s.tags.map(tag => [tag.name, {
          from: tag.from, to: tag.to, direction: tag.direction, repeat: tag.repeat ?? 0,
          duration: s.frames.slice(tag.from, tag.to + 1).reduce((a, f) => a + f.duration, 0),
        }])),
        // Every state with its playback and switching rules, and the tag of each direction
        states: Object.fromEntries(rig.states.map(st => [st.id, { ...st, tags: rig.cells[st.id] ?? {}, ...(st.alt.on ? { altTags: rig.cells[altRow(st.id)] ?? {} } : {}) }])),
        physics: rig.physics,
        collider: rig.collider,
        // Per frame box of each slice, relative to the frame; null where the slice has no key yet
        boxes: Object.fromEntries(s.slices.map(sl => [sl.name, s.frames.map((_, f) => {
          const k = sliceKey(sl, f);
          return k && { x: k.x, y: k.y, w: k.w, h: k.h, pivot: k.pivot ?? null };
        })])),
      };
      const png = new Uint8Array(await (await sheet.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return zip([{ name: 'sheet.png', data: png }, { name: 'rig.json', data: new TextEncoder().encode(JSON.stringify(json, null, 2)) }]);
    } finally {
      await progress.done();
    }
  }

  return { getRig: async () => { const s = await ctx.sprite.get().catch(() => null); return s ? getRig(s) : null; } };
});
