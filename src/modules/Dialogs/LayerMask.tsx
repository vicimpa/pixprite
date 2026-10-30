import { useState, type FC } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { state } from '~/core/State';
import { packRgba } from '~/core/Image';
import { t } from '~/core/i18n';
import { Button, Check, Label, Muted, Select } from '~/ui/Button';
import { Dialog, openDialog, Row } from '~/ui/Dialog';

const LayerMaskDialog: FC<{ close: () => void; index: number }> = ({ close, index }) => {
  useSignals();
  const [sprite] = useState(() => state.sprite);
  const [source, setSource] = useState(() => sprite.layers.findIndex((l, i) => i !== index && !l.reference));
  const layer = sprite.layers[index], mask = layer?.mask;
  const locked = !layer || !!layer.reference || sprite.lockedDeep(index);
  const changed = (action: () => unknown) => { action(); state.save(); };
  const create = (kind: 'reveal' | 'selection' | 'alpha' | 'color') => changed(() => {
    const [r, g, b, a] = state.colorA.rgba;
    sprite.createLayerMask(kind, source, packRgba(r, g, b, Math.round(a * 255)), index);
  });
  return <Dialog title={t('mask.title')} width={440} onClose={close} onSubmit={() => {}} cancelLabel={null}>
    <strong>{layer?.name}</strong>
    <Muted style={{ whiteSpace: 'normal' }}>{t('mask.hint')}</Muted>
    <Row style={{ flexWrap: 'wrap' }}>
      <Button type="button" disabled={locked} onClick={() => create('reveal')}>{t('mask.reveal')}</Button>
      <Button type="button" disabled={locked || !sprite.mask} onClick={() => create('selection')}>{t('mask.selection')}</Button>
      <Button type="button" disabled={locked} onClick={() => create('color')}>{t('mask.color')}</Button>
    </Row>
    <Row>
      <Select title={t('mask.source')} value={source} onChange={e => setSource(+e.target.value)}>
        {sprite.layers.map((l, i) => i !== index && !l.reference ? <option key={i} value={i}>{l.name}</option> : null)}
      </Select>
      <Button type="button" disabled={locked || source < 0} onClick={() => create('alpha')}>{t('mask.alpha')}</Button>
    </Row>
    <Muted style={{ whiteSpace: 'normal' }}>{t('mask.createHint')}</Muted>
    {mask && <>
      <Row>
        <Label><Check checked={mask.enabled} disabled={locked} onChange={e => changed(() => sprite.updateLayerMask({ enabled: e.target.checked }, index))} /> {t('mask.enabled')}</Label>
        <Label><Check checked={mask.inverted} disabled={locked} onChange={e => changed(() => sprite.updateLayerMask({ inverted: e.target.checked }, index))} /> {t('mask.inverted')}</Label>
      </Row>
      <Row>
        <Button type="button" onClick={() => { sprite.layer = index; sprite.setEditingChannel('mask'); close(); }}>{t('mask.edit')}</Button>
        <Button type="button" onClick={() => { sprite.setEditingChannel('color'); close(); }}>{t('mask.colorChannel')}</Button>
        <Button type="button" disabled={locked} onClick={() => changed(() => sprite.updateLayerMask(null, index))}>{t('mask.remove')}</Button>
      </Row>
    </>}
  </Dialog>;
};

export const layerMask = (index = state.sprite.layer) => openDialog(close => <LayerMaskDialog close={close} index={index} />);
