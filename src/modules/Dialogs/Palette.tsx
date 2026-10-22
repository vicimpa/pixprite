import { PRESET_PALETTES } from "~/core/formats/Palette";
import { isCancelled } from "~/core/Work";
import { imageFilePixels, insertRamp, paletteFromImage, paletteFromSpriteAsync, setPaletteSize, type RampSpace } from "~/core/PaletteOps";
import { state } from "~/core/State";
import { Button, Check, Input, Label, Muted, Select } from "~/ui/Button";
import { t } from "~/core/i18n";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useState, type FC } from "react";
import styled from "styled-components";

const PaletteSize: FC<{ close: () => void; }> = ({ close }) => {
  const [n, setN] = useState(state.palette.length);
  return (
    <Dialog title={t('dialog.paletteSize.title')} onClose={close} onSubmit={() => { setPaletteSize(n); state.save(); }}>
      <Row>
        <FieldLabel>{t('dialog.paletteSize.entries')}</FieldLabel>
        <Input type="number" min={1} max={1024} value={n} onChange={e => setN(Math.max(1, +e.target.value | 0))} />
      </Row>
      <Muted>{t('dialog.paletteSize.newEntriesAreFilled')}</Muted>
    </Dialog>
  );
};

const FromSprite: FC<{ close: () => void; }> = ({ close }) => {
  const sel = state.paletteSelection.length;
  const [count, setCount] = useState(32);
  const [alpha, setAlpha] = useState(false);
  const [target, setTarget] = useState<'new' | 'selection'>('new');
  const [image, setImage] = useState<{ name: string; data: Uint32Array; } | null>(null);
  return (
    <Dialog title={t('dialog.fromSprite.paletteFromTheSprite')} onClose={close} submitLabel={t('common.create')} onSubmit={() => void (async () => {
      const n = target === 'selection' ? sel : count;
      let colors: string[];
      try { colors = image ? paletteFromImage(image.data, n, alpha) : await paletteFromSpriteAsync(n, alpha); }
      catch (e) { if (isCancelled(e)) return; throw e; }
      if (target === 'selection') {
        // Results go into the selected slots in order
        const pal = state.palette.slice();
        state.paletteSelection.slice().sort((a, b) => a - b).forEach((i, k) => { if (colors[k]) pal[i] = colors[k]; });
        state.palette = pal;
      } else {
        state.palette = colors.length ? colors : state.palette;
        state.paletteSelection = [];
      }
      state.save();
    })()}>
      <Row>
        <FieldLabel>{t('dialog.fromSprite.source')}</FieldLabel>
        <Muted>{image ? image.name : t('dialog.fromSprite.theSprite')}</Muted>
        <Button type="button" onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            const f = input.files?.[0];
            if (f) setImage({ name: f.name, data: await imageFilePixels(f) });
          };
          input.click();
        }}>{t('dialog.fromSprite.imageFile')}</Button>
        {image && <Button type="button" onClick={() => setImage(null)}>{t('dialog.fromSprite.useTheSprite')}</Button>}
      </Row>
      <Row>
        <FieldLabel>{t('dialog.fromSprite.into')}</FieldLabel>
        <Select value={target} onChange={e => setTarget(e.target.value as 'new' | 'selection')}>
          <option value="new">{t('dialog.fromSprite.aNewPalette')}</option>
          {sel > 1 && <option value="selection">The {sel} selected entries</option>}
        </Select>
      </Row>
      {target === 'new' && (
        <Row>
          <FieldLabel>{t('common.colors')}</FieldLabel>
          <Input type="number" min={1} max={256} value={count} onChange={e => setCount(Math.max(1, Math.min(256, +e.target.value | 0)))} />
        </Row>
      )}
      <Label><Check checked={alpha} onChange={e => setAlpha(e.target.checked)} /> {t('dialog.fromSprite.keepSemiTransparentColors')}</Label>
      <Muted>{t('dialog.fromSprite.exactColorsAreKept')}</Muted>
    </Dialog>
  );
};

const PresetRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  cursor: pointer;
  border: 1px solid transparent;

  &:hover { border-color: var(--b2); background: var(--face); }
  &[data-active=true] { border-color: var(--accent); }
`;

const Strip = styled.div`
  display: flex;
  flex-grow: 1;
  height: 14px;
  border: 1px solid var(--b1);

  & > span { flex: 1 1 0; }
`;

const Presets: FC<{ close: () => void; }> = ({ close }) => {
  const [pick, setPick] = useState(0);
  return (
    <Dialog title={t('dialog.presets.palettePresets')} onClose={close} submitLabel={t('dialog.presets.usePalette')} width={420} onSubmit={() => {
      state.palette = PRESET_PALETTES[pick].colors.slice();
      state.paletteSelection = [];
      state.save();
    }}>
      {PRESET_PALETTES.map((p, i) => (
        <PresetRow key={p.name} data-active={i === pick} onClick={() => setPick(i)} onDoubleClick={() => { setPick(i); }}>
          <span style={{ minWidth: 90 }}>{p.name}</span>
          <Strip>{p.colors.map((c, k) => <span key={k} style={{ background: c }} />)}</Strip>
        </PresetRow>
      ))}
      <Muted>{t('dialog.presets.paletteFilesGplPal')}</Muted>
    </Dialog>
  );
};

const SPACES: [RampSpace, string][] = [['rgb', 'dialog.ramp.rgbStraight'], ['hsv', 'dialog.ramp.hsvAroundTheHue'], ['oklab', 'common.perceptualOklab']];

const Ramp: FC<{ close: () => void; }> = ({ close }) => {
  const sel = state.paletteSelection.slice().sort((a, b) => a - b);
  const last = state.palette.length - 1;
  const [a, setA] = useState(sel[0] ?? 0);
  const [b, setB] = useState(sel.length > 1 ? sel[sel.length - 1] : Math.min(last, (sel[0] ?? 0) + 1));
  const [steps, setSteps] = useState(4);
  const [space, setSpace] = useState<RampSpace>('oklab');
  const idx = (v: string) => Math.max(0, Math.min(last, +v | 0));
  return (
    <Dialog title={t('dialog.ramp.colorRamp')} onClose={close} submitLabel={t('dialog.ramp.insert')} onSubmit={() => {
      if (insertRamp(a, b, steps, space)) state.save();
      else state.showTip(t('dialog.ramp.pickTwoDifferentEntries'));
    }}>
      <Row>
        <FieldLabel>{t('dialog.ramp.fromEntry')}</FieldLabel>
        <Input type="number" min={0} max={last} value={a} onChange={e => setA(idx(e.target.value))} />
        <span style={{ width: 16, height: 16, background: state.palette[a] }} />
      </Row>
      <Row>
        <FieldLabel>{t('dialog.ramp.toEntry')}</FieldLabel>
        <Input type="number" min={0} max={last} value={b} onChange={e => setB(idx(e.target.value))} />
        <span style={{ width: 16, height: 16, background: state.palette[b] }} />
      </Row>
      <Row>
        <FieldLabel>{t('dialog.ramp.steps')}</FieldLabel>
        <Input type="number" min={1} max={64} value={steps} onChange={e => setSteps(Math.max(1, Math.min(64, +e.target.value | 0)))} />
      </Row>
      <Row>
        <FieldLabel>{t('dialog.ramp.blendIn')}</FieldLabel>
        <Select value={space} onChange={e => setSpace(e.target.value as RampSpace)}>
          {SPACES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </Select>
      </Row>
      <Muted>{t('dialog.ramp.theNewColorsGo')}</Muted>
    </Dialog>
  );
};

export const paletteDialogs = {
  ramp: () => openDialog(close => <Ramp close={close} />),
  size: () => openDialog(close => <PaletteSize close={close} />),
  fromSprite: () => openDialog(close => <FromSprite close={close} />),
  presets: () => openDialog(close => <Presets close={close} />),
};
