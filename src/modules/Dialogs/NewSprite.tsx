import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { Button, Input, Muted, Select } from "~/ui/Button";
import { Dialog, openDialog, Row, FieldLabel } from "~/ui/Dialog";
import { useState, type FC } from "react";
import { loadDialogPrefs, saveDialogPrefs, num, Field, NumberField } from "./fields";

const PRESETS = [[16, 16], [32, 32], [48, 48], [64, 64], [128, 128], [160, 144], [256, 240]];

const NewSprite: FC<{ close: () => void; }> = ({ close }) => {
  // The clipboard image size wins over the last used size
  const last = loadDialogPrefs('new', { w: 32, h: 32, bg: 'transparent' as 'transparent' | 'white' | 'black' | 'secondary' });
  const clip = state.clipboard;
  const [w, setW] = useState(String(clip?.w ?? last.w));
  const [h, setH] = useState(String(clip?.h ?? last.h));
  const [name, setName] = useState('untitled');
  const [bg, setBg] = useState(last.bg);
  return (
    <Dialog title={t('common.newSprite')} onClose={close} submitLabel={t('common.create')} onSubmit={() => {
      const W = Math.max(1, Math.min(4096, num(w, 32) | 0)), H = Math.max(1, Math.min(4096, num(h, 32) | 0));
      saveDialogPrefs('new', { w: W, h: H, bg });
      const sprite = state.newDocument();
      sprite.reset(W, H, name || 'untitled');
      if (bg !== 'transparent') {
        // A solid background becomes a real background layer
        const fill = bg === 'white' ? 0xffffffff : bg === 'black' ? 0xff000000 : sprite.backgroundFill;
        sprite.layers = sprite.layers.map(l => ({ ...l, background: true, name: 'Background' }));
        sprite.setCel({ x: 0, y: 0, w: W, h: H, data: new Uint32Array(sprite.size).fill(fill) });
      }
      state.fit();
      state.save();
    }}>
      <Field label={t('common.name')}><Input value={name} style={{ width: 160 }} onChange={e => setName(e.target.value)} /></Field>
      <NumberField label={t('common.width')} value={w} onChange={setW} min={1} max={4096} suffix="px" />
      <NumberField label={t('common.height')} value={h} onChange={setH} min={1} max={4096} suffix="px" />
      <Row>
        <FieldLabel>{t('dialog.newSprite.presets')}</FieldLabel>
        {PRESETS.map(([pw, ph]) => (
          <Button type="button" key={pw + 'x' + ph} onClick={() => { setW(String(pw)); setH(String(ph)); }}>{pw}×{ph}</Button>
        ))}
      </Row>
      <Field label={t('dialog.newSprite.background')}>
        <Select value={bg} onChange={e => setBg(e.target.value as typeof bg)}>
          <option value="transparent">{t('dialog.newSprite.transparent')}</option>
          <option value="white">{t('dialog.newSprite.white')}</option>
          <option value="black">{t('dialog.newSprite.black')}</option>
          <option value="secondary">{t('dialog.newSprite.secondaryColor')}</option>
        </Select>
      </Field>
      {clip && <Muted>{t('dialog.newSprite.sizeTakenFromThe')}</Muted>}
    </Dialog>
  );
};


export const newSprite = () => openDialog(close => <NewSprite close={close} />);
