import type { ColorMode, Dither } from "./ColorMode";
import { state } from "./State";
import { t } from "./i18n";
import { isCancelled, runTask, withProgress } from "./Work";

/**
 * Converts the active sprite; the pixel work runs in the background with a progress overlay
 * (Cancel leaves the sprite as it was). Resolves when done or cancelled
 */
export function convertSpriteColorMode(mode: ColorMode, dither: Dither = 'none', amount = 1) {
  const { sprite } = state;
  return withProgress(t('dialog.colorMode.convertingColorMode'), (onProgress, signal) => sprite.convertColorModeAsync(mode, dither, amount,
    (cels, palette) => runTask('convert', {
      cels: cels.map(({ data, w, h, x, y }) => ({ data, w, h, x, y })), mode, palette, dither, amount,
    }, { onProgress, signal })))
    .then(() => state.save(), e => { if (!isCancelled(e)) throw e; });
}

