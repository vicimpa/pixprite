import { t } from "~/core/i18n";
import { convertPixels, type ColorMode, type Dither } from "~/core/ColorMode";
import { state } from "~/core/State";
import { isCancelled, runTask, withProgress } from "~/core/Work";
import { Check, Label, Muted, Range, Select } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useEffect, useState, type FC } from "react";

const MODES: [ColorMode, string][] = [
  ['rgb', 'RGB (any color)'],
  ['indexed', 'Indexed (palette colors only)'],
  ['gray', 'Grayscale'],
];

const DITHERS: [Dither, string][] = [
  ['none', 'None (nearest color)'],
  ['bayer2', 'Pattern 2×2'],
  ['bayer4', 'Pattern 4×4'],
  ['bayer8', 'Pattern 8×8'],
  ['diffusion', 'Error diffusion'],
  ['atkinson', 'Error diffusion, light (Atkinson)'],
];

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

export const COLOR_MODES = MODES;
export const DITHER_MODES = DITHERS;

const ColorModeDialog: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const [mode, setMode] = useState<ColorMode>(sprite.colorMode === 'indexed' ? 'rgb' : 'indexed');
  const [dither, setDither] = useState<Dither>('none');
  const [amount, setAmount] = useState(100);
  const [preview, setPreview] = useState(true);

  // Live preview of the current cel (debounced)
  useEffect(() => {
    if (!preview || mode === 'rgb') { state.filterPreview = null; return; }
    const t = setTimeout(() => {
      const data = sprite.canvasPixels();
      convertPixels(data, sprite.width, sprite.height, mode, sprite.palette, dither, amount / 100);
      state.filterPreview = { layer: sprite.layer, frame: sprite.frame, data };
    }, 60);
    return () => clearTimeout(t);
  }, [mode, dither, amount, preview]);
  useEffect(() => () => { state.filterPreview = null; }, []);

  return (
    <Dialog title={`Color mode (now ${sprite.colorMode})`} onClose={close} submitLabel={t('common.convert')} onSubmit={() => {
      state.filterPreview = null;
      convertSpriteColorMode(mode, dither, amount / 100).catch(e => state.showTip(String((e as Error)?.message ?? e), 3000));
    }}>
      <Row>
        <FieldLabel>{t('dialog.colorMode.convertTo')}</FieldLabel>
        <Select value={mode} onChange={e => setMode(e.target.value as ColorMode)}>
          {MODES.filter(([m]) => m !== sprite.colorMode).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </Select>
      </Row>
      {mode === 'indexed' && <>
        <Row>
          <FieldLabel>{t('dialog.colorMode.dithering')}</FieldLabel>
          <Select value={dither} onChange={e => setDither(e.target.value as Dither)}>
            {DITHERS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </Select>
        </Row>
        {dither !== 'none' && (
          <Row>
            <FieldLabel>{t('common.amount')}</FieldLabel>
            <Range min={0} max={100} value={amount} onChange={e => setAmount(+e.target.value)} />
            <Muted>{amount}%</Muted>
          </Row>
        )}
        <Muted>Uses the current palette ({state.palette.length} colors). Make one from the sprite first for the best match.</Muted>
        <Muted>{t('dialog.colorMode.whileIndexedEverythingYou')}</Muted>
      </>}
      {mode === 'gray' && <Muted>{t('dialog.colorMode.brightnessIsKeptColor')}</Muted>}
      <Label><Check checked={preview} onChange={e => setPreview(e.target.checked)} /> {t('dialog.colorMode.previewTheCurrentCel')}</Label>
    </Dialog>
  );
};

export const colorModeDialog = () => openDialog(close => <ColorModeDialog close={close} />);
