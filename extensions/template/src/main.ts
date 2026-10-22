/**
 * Worker side: runs once when the extension is enabled.
 * Every ctx call is async and goes to the editor over postMessage.
 */
import { defineExtension } from "@pixprite/api";

export default defineExtension(ctx => {
  const { t } = ctx.i18n;

  // Command declared in manifest.json → contributes.commands
  ctx.commands.register('hello', async () => {
    const s = await ctx.sprite.get().catch(() => null);
    if (!s) return ctx.ui.notify(t('noSprite'), 'warning');
    await ctx.ui.notify(t('hello', { name: s.name, w: s.width, h: s.height }), 'success');
  });

  // Whatever activate returns is callable by other extensions: ctx.extensions.get('template')
  return {
    greet: (who: string) => `Hello, ${who}`,
  };
});
