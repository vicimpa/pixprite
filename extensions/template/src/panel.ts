/**
 * Panel side: a sandboxed iframe with the same ctx.
 * Uses the editor's theme variables through plain css (the host passes them in on init).
 */
import { connect } from "@pixprite/api";

const ctx = await connect();
const { t } = ctx.i18n;
const root = document.getElementById('root')!;

async function refresh() {
  const s = await ctx.sprite.get().catch(() => null);
  root.textContent = s
    ? `${s.name}: ${s.width}×${s.height}, ${t('layers', { count: s.layers.length })}`
    : t('noSprite');
}

ctx.events.on('sprite:change', refresh);
ctx.documents.on('change', refresh);
ctx.i18n.on('change', refresh);
refresh();
