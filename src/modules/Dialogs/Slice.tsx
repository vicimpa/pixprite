import { t } from "~/core/i18n";
import { ColorInput } from "~/ui/ColorInput";
import { sliceKey, type SliceKey } from "~/core/Sprite";
import { state } from "~/core/State";
import { Check, Input, Label, Muted } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useState, type FC } from "react";

const Num: FC<{ value: number; set: (v: number) => void; min?: number; }> = ({ value, set, min = -9999 }) => (
  <Input type="number" min={min} value={value} style={{ width: 56 }} onChange={e => set(Math.max(min, Math.round(+e.target.value) || 0))} />
);

const SliceProperties: FC<{ close: () => void; index: number; }> = ({ close, index }) => {
  const { sprite } = state;
  const sl = sprite.slices[index];
  const key = sliceKey(sl, sprite.frame) ?? sl.keys[0];
  const [name, setName] = useState(sl.name);
  const [color, setColor] = useState(sl.color);
  const [note, setNote] = useState(sl.userData?.text ?? '');
  const [k, setK] = useState<SliceKey>({ ...key });
  const set = (patch: Partial<SliceKey>) => setK({ ...k, ...patch });
  const c = k.center, p = k.pivot;
  return (
    <Dialog title={t('dialog.sliceProperties.title')} onClose={close} onSubmit={() => {
      sprite.checkpoint('Slice properties');
      sprite.updateSlice(index, { name: name || sl.name, color, userData: note ? { text: note } : undefined }, null);
      sprite.updateSliceKey(index, { ...k, w: Math.max(1, k.w), h: Math.max(1, k.h) }, null);
      state.save();
    }}>
      <Row><FieldLabel>{t('common.name')}</FieldLabel><Input value={name} onChange={e => setName(e.target.value)} style={{ width: 160 }} /></Row>
      <Row><FieldLabel>{t('common.color')}</FieldLabel><ColorInput value={color} onChange={setColor} /></Row>
      <Row><FieldLabel>{t('common.note')}</FieldLabel><Input value={note} onChange={e => setNote(e.target.value)} style={{ width: 160 }} /></Row>
      <Row>
        <FieldLabel>{t('dialog.sliceProperties.bounds')}</FieldLabel>
        <Num value={k.x} set={x => set({ x })} /> <Num value={k.y} set={y => set({ y })} />
        <Num value={k.w} min={1} set={w => set({ w })} />×<Num value={k.h} min={1} set={h => set({ h })} />
      </Row>
      <Label>
        <Check checked={!!c} onChange={e => set({
          center: e.target.checked ? { x: 1, y: 1, w: Math.max(1, k.w - 2), h: Math.max(1, k.h - 2) } : undefined,
        })} /> 9-slice (stretchable middle)
      </Label>
      {c && (
        <Row>
          <FieldLabel>{t('dialog.sliceProperties.middle')}</FieldLabel>
          <Num value={c.x} set={x => set({ center: { ...c, x } })} /> <Num value={c.y} set={y => set({ center: { ...c, y } })} />
          <Num value={c.w} min={1} set={w => set({ center: { ...c, w } })} />×<Num value={c.h} min={1} set={h => set({ center: { ...c, h } })} />
        </Row>
      )}
      <Label><Check checked={!!p} onChange={e => set({ pivot: e.target.checked ? { x: 0, y: 0 } : undefined })} /> {t('dialog.sliceProperties.pivotPoint')}</Label>
      {p && (
        <Row>
          <FieldLabel>{t('common.pivot')}</FieldLabel>
          <Num value={p.x} set={x => set({ pivot: { ...p, x } })} /> <Num value={p.y} set={y => set({ pivot: { ...p, y } })} />
        </Row>
      )}
      <Muted>{t('dialog.sliceProperties.middleAndPivotAre')}</Muted>
    </Dialog>
  );
};

export const sliceProperties = (index = state.sprite.selectedSlices[0] ?? 0) =>
  state.sprite.slices[index] ? openDialog(close => <SliceProperties close={close} index={index} />) : () => { };
