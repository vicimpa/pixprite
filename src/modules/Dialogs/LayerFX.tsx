import { useEffect, useState, type FC } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { packRgba } from '~/core/Image';
import { hasColorEffects, type LayerFX } from '~/core/DocumentModel';
import { state } from '~/core/State';
import { t } from '~/core/i18n';
import { Button, Check, Input, Label, Muted, Select } from '~/ui/Button';
import { Dialog, openDialog, Row } from '~/ui/Dialog';

const LayerFXDialog: FC<{ close: () => void; index: number }> = ({ close, index }) => {
  useSignals();
  const [sprite] = useState(() => state.sprite);
  const [initialFrame] = useState(sprite.frame);
  const [wasPlaying] = useState(state.playing);
  const [initial] = useState(() => sprite.layers[index].effects ?? []);
  const [draft, setDraft] = useState<LayerFX[]>(() => initial.map(effect => ({ ...effect })));
  const [preview, setPreview] = useState(true);
  const [scope, setScope] = useState<'layer' | 'frame' | 'range'>('layer');
  const [error, setError] = useState('');
  const layer = sprite.layers[index];
  const editable = !layer.reference && !sprite.lockedDeep(index);
  const update = (next: LayerFX) => setDraft(effects => effects.map(effect => effect.id === next.id ? next : effect));
  const move = (at: number, by: number) => setDraft(effects => {
    const next = effects.slice();
    [next[at], next[at + by]] = [next[at + by], next[at]];
    return next;
  });
  useEffect(() => {
    try {
      // Validate even with Preview off, so Apply and Bake can report oversized output safely.
      sprite.previewLayerEffects(draft, index);
      if (!preview) sprite.previewLayerEffects(null);
      setError('');
    } catch (error) {
      sprite.previewLayerEffects(null);
      setError(error instanceof RangeError ? t('dialog.layerFX.bounds') : String(error));
    }
  }, [draft, preview, sprite, index]);
  useEffect(() => () => {
    sprite.previewLayerEffects(null);
    state.playing = wasPlaying;
    sprite.frame = initialFrame;
  }, []);
  const finish = () => { sprite.previewLayerEffects(null); close(); };
  const bake = () => {
    state.playing = false;
    sprite.frame = initialFrame;
    sprite.previewLayerEffects(null);
    try {
      if (!sprite.bakeLayerEffects(scope, index, draft)) { setError(t('dialog.layerFX.cannotBake')); sprite.previewLayerEffects(preview ? draft : null, index); return; }
      state.save();
      close();
    } catch (error) {
      setError(error instanceof RangeError ? t('dialog.layerFX.bounds') : String(error));
      sprite.previewLayerEffects(null);
    }
  };
  return <Dialog title={t('dialog.layerFX.title')} width={530} onClose={finish} submitLabel={t('common.apply')}
    onSubmit={() => {
      if (error) return false;
      if (editable && JSON.stringify(draft) !== JSON.stringify(initial)) { sprite.setLayerEffects(draft, index); state.save(); }
    }}>
    <strong>{layer.name}</strong>
    <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.hint')}</Muted>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '38vh', overflow: 'auto' }}>
      {!draft.length && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.empty')}</Muted>}
      {draft.map((effect, i) => <Row key={effect.id} data-testid="layer-effect" style={{ flexWrap: 'wrap' }}>
        <Label><Check aria-label={t('dialog.layerFX.enabled')} checked={effect.enabled} disabled={!editable}
          onChange={event => update({ ...effect, enabled: event.target.checked })} /> {effect.type === 'opacity' ? t('common.opacity') : t(`dialog.layerFX.${effect.type}`)}</Label>
        {effect.type === 'opacity' ? <>
          <Input aria-label={t('dialog.layerFX.amount')} type="number" min={0} max={100} step={1} disabled={!editable}
            value={Math.round(effect.amount * 100)} onChange={event => update({ ...effect, amount: Math.max(0, Math.min(100, Number(event.target.value))) / 100 })} />
          <Muted style={{ whiteSpace: 'normal' }}>%</Muted>
        </> : <>
          <Label>{t(effect.type === 'outline' ? 'dialog.layerFX.color' : 'dialog.layerFX.effectColor')} <input aria-label={t(effect.type === 'outline' ? 'dialog.layerFX.color' : 'dialog.layerFX.effectColor')} type="color" disabled={!editable}
            value={'#' + [0, 8, 16].map(shift => ((effect.color >>> shift) & 255).toString(16).padStart(2, '0')).join('')}
            onChange={event => {
              const rgb = event.target.value.slice(1);
              update({ ...effect, color: packRgba(parseInt(rgb.slice(0, 2), 16), parseInt(rgb.slice(2, 4), 16), parseInt(rgb.slice(4, 6), 16), effect.color >>> 24) });
            }} /></Label>
          <Label>{t(effect.type === 'outline' ? 'dialog.layerFX.alpha' : 'dialog.layerFX.effectAlpha')} <Input aria-label={t(effect.type === 'outline' ? 'dialog.layerFX.alpha' : 'dialog.layerFX.effectAlpha')} type="number" min={0} max={255} step={1}
            disabled={!editable} value={effect.color >>> 24} onChange={event => update({ ...effect,
              color: ((effect.color & 0xffffff) | (Math.max(0, Math.min(255, Math.round(+event.target.value))) << 24)) >>> 0 })} /></Label>
          {effect.type === 'outline' && <><Label>{t('dialog.layerFX.thickness')} <Input aria-label={t('dialog.layerFX.thickness')} type="number" min={1} max={128} step={1}
            disabled={!editable} value={effect.thickness} onChange={event => update({ ...effect, thickness: Math.max(1, Math.min(128, Math.round(+event.target.value) || 1)) })} /></Label>
          <Select title={t('dialog.layerFX.position')} value={effect.position} disabled={!editable}
            onChange={event => update({ ...effect, position: event.target.value as typeof effect.position })}>
            <option value="inside">{t('dialog.layerFX.inside')}</option>
            <option value="center">{t('dialog.layerFX.center')}</option>
            <option value="outside">{t('dialog.layerFX.outside')}</option>
          </Select>
          <Select title={t('dialog.layerFX.join')} value={effect.join} disabled={!editable}
            onChange={event => update({ ...effect, join: event.target.value as typeof effect.join })}>
            <option value="round">{t('dialog.layerFX.round')}</option>
            <option value="miter">{t('dialog.layerFX.miter')}</option>
            <option value="bevel">{t('dialog.layerFX.bevel')}</option>
          </Select></>}
          {(effect.type === 'shadow' || effect.type === 'glow') && <Label>{t('dialog.layerFX.size')} <Input aria-label={t('dialog.layerFX.size')}
            type="number" min={effect.type === 'shadow' ? 0 : 1} max={128} step={1} disabled={!editable} value={effect.size}
            onChange={event => update({ ...effect, size: Math.max(effect.type === 'shadow' ? 0 : 1, Math.min(128, Math.round(+event.target.value) || 0)) })} /></Label>}
          {effect.type === 'shadow' && (['x', 'y'] as const).map(axis => <Label key={axis}>{axis.toUpperCase()} <Input aria-label={t(axis === 'x' ? 'dialog.layerFX.shadowX' : 'dialog.layerFX.shadowY')}
            type="number" min={-1024} max={1024} step={1} disabled={!editable} value={effect[axis]}
            onChange={event => update({ ...effect, [axis]: Math.max(-1024, Math.min(1024, Math.round(+event.target.value) || 0)) })} /></Label>)}
          {effect.type === 'glow' && <Select title={t('dialog.layerFX.glowPosition')} value={effect.position} disabled={!editable}
            onChange={event => update({ ...effect, position: event.target.value as typeof effect.position })}>
            <option value="inside">{t('dialog.layerFX.inside')}</option><option value="outside">{t('dialog.layerFX.outside')}</option>
          </Select>}
        </>}
        <Button type="button" aria-label={t('dialog.layerFX.up')} disabled={!editable || i === 0} onClick={() => move(i, -1)}>↑</Button>
        <Button type="button" aria-label={t('dialog.layerFX.down')} disabled={!editable || i === draft.length - 1} onClick={() => move(i, 1)}>↓</Button>
        <Button type="button" disabled={!editable} onClick={() => setDraft(effects => effects.filter(item => item.id !== effect.id))}>{t('common.delete')}</Button>
      </Row>)}
    </div>
    <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
      { id: crypto.randomUUID(), type: 'opacity', enabled: true, amount: 1 }])}>{t('dialog.layerFX.addOpacity')}</Button>
    <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
      { id: crypto.randomUUID(), type: 'outline', enabled: true, color: 0xff000000, thickness: 1, position: 'outside', join: 'round' }])}>{t('dialog.layerFX.addOutline')}</Button>
    <Row style={{ flexWrap: 'wrap' }}>
      <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
        { id: crypto.randomUUID(), type: 'outline', enabled: true, color: 0xff000000, thickness: 1, position: 'inside', join: 'round' }])}>{t('dialog.layerFX.addInnerOutline')}</Button>
      <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
        { id: crypto.randomUUID(), type: 'shadow', enabled: true, color: 0x80000000, x: 2, y: 2, size: 2 }])}>{t('dialog.layerFX.addShadow')}</Button>
      <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
        { id: crypto.randomUUID(), type: 'glow', enabled: true, color: 0xffffffff, size: 3, position: 'outside' }])}>{t('dialog.layerFX.addGlow')}</Button>
      <Button type="button" disabled={!editable || draft.length >= 64} onClick={() => setDraft(effects => [...effects,
        { id: crypto.randomUUID(), type: 'overlay', enabled: true, color: 0xff000000 }])}>{t('dialog.layerFX.addOverlay')}</Button>
    </Row>
    {layer.bakedEffects?.some(ids => ids.length > 0) && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.residual')}</Muted>}
    <Row>
      <Label><Check checked={preview} onChange={event => setPreview(event.target.checked)} /> {t('common.preview')}</Label>
      <Button type="button" disabled={sprite.frames.length < 2} onClick={() => { state.playing = !state.playing; }}>
        {state.playing ? t('dialog.layerFX.stop') : t('dialog.layerFX.play')}
      </Button>
      <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.frame', { n: sprite.frame + 1 })}</Muted>
    </Row>
    <Row>
      <Select title={t('dialog.layerFX.scope')} value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
        <option value="layer">{t('dialog.layerFX.layer')}</option>
        <option value="frame">{t('dialog.layerFX.currentFrame', { n: initialFrame + 1 })}</option>
        {sprite.range && sprite.range.type !== 'layers' && <option value="range">{t('dialog.layerFX.range')}</option>}
      </Select>
      <Button type="button" disabled={!editable || !draft.length || !!error} onClick={bake}>{t('dialog.layerFX.bake')}</Button>
    </Row>
    {layer.group && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.groupBake')}</Muted>}
    {layer.tileset >= 0 && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.tileBake')}</Muted>}
    {sprite.colorMode === 'gray' && hasColorEffects(draft) && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.grayscaleBake')}</Muted>}
    {sprite.colorMode === 'indexed' && <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.layerFX.indexedBake')}</Muted>}
    {error && <span role="alert">{error}</span>}
  </Dialog>;
};

export const layerEffects = (index = state.sprite.layer) => openDialog(close => <LayerFXDialog index={index} close={close} />);
