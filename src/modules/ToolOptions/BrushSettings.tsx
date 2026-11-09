import { useSignals } from '@preact/signals-react/runtime';
import { state } from '~/core/State';
import { applyStamp } from '~/core/Brushes';
import { BUILTIN_STAMPS } from '~/core/Stamps';
import type { BrushAngleDynamics } from '~/core/BrushDynamics';
import { t } from '~/core/i18n';
import { Label, Select } from '~/ui/Button';
import { Button, Input } from '~/ui/Button';
import { runCommand } from '~/core/Commands';
import { exportBrushes, exportBrushPng, importBrushes } from '~/core/BrushIO';

/** Additional brush controls in the pen palette. */
export default function BrushSettings({ stamps, stroke }: { stamps: boolean; stroke: boolean }) {
  useSignals();
  const b = state.customBrush;
  return <>
    <Label title={t('options.angleDynamicsHint')}>
      {t('options.angleDynamics')}
      <Select value={state.brushAngleDynamics} onChange={e => { state.brushAngleDynamics = e.target.value as BrushAngleDynamics; }}>
        <option value="fixed">{t('options.angleDynamicsFixed')}</option>
        <option value="stroke">{t('options.angleDynamicsStroke')}</option>
        <option value="tilt">{t('options.angleDynamicsTilt')}</option>
        <option value="twist">{t('options.angleDynamicsTwist')}</option>
      </Select>
    </Label>
    {stamps && <Label>
      {t('options.stampPreset')}
      <Select value={b?.stampId ?? (b ? 'custom' : '')} onChange={e => {
        if (!e.target.value) { state.customBrush = null; return; }
        const stamp = BUILTIN_STAMPS.find(s => s.id === e.target.value);
        if (stamp) applyStamp(stamp);
      }}>
        <option value="">—</option>
        {BUILTIN_STAMPS.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
        {b && !b.stampId && <option value="custom">{t('stamp.custom')}</option>}
      </Select>
    </Label>}
    {stamps && <Button disabled={!state.sprite.mask} onClick={() => runCommand('edit.brushFromSelection')}>{t('brush.fromSelection')}</Button>}
    {stroke && <>
      <Label>{t('brush.application')}<Select value={state.brushMode} onChange={e => { state.brushMode = e.target.value as typeof state.brushMode; }}>
        <option value="continuous">{t('brush.continuous')}</option><option value="stamp">{t('brush.single')}</option>
      </Select></Label>
      <Label title={t('brush.spacingHint')}>{t('brush.spacing')}
        <Input type="number" min={0} max={1000} value={state.brushSpacing} disabled={state.brushMode === 'stamp'}
          onChange={e => { state.brushSpacing = Math.max(0, Math.min(1000, Math.round(+e.target.value) || 0)); }} />
      </Label>
    </>}
    {b && <>
      <Label>{t('brush.scale')}<Input type="number" min={1} max={400} value={state.brushScale}
        onChange={e => { state.brushScale = Math.max(1, Math.min(400, Math.round(+e.target.value) || 1)); }} /></Label>
      <Button $active={state.brushFlipX} aria-pressed={state.brushFlipX} onClick={() => { state.brushFlipX = !state.brushFlipX; }}>{t('brush.flipX')}</Button>
      <Button $active={state.brushFlipY} aria-pressed={state.brushFlipY} onClick={() => { state.brushFlipY = !state.brushFlipY; }}>{t('brush.flipY')}</Button>
      <Button title={t('brush.resetTransform')} onClick={() => { state.brushScale = 100; state.brushFlipX = state.brushFlipY = false; state.brushAngle = 0; }}>100%</Button>
    </>}
    {stamps && <>
      <Button onClick={() => void importBrushes()}>{t('brush.import')}</Button>
      <Button disabled={!b} onClick={() => exportBrushes()}>{t('brush.export')}</Button>
      <Button disabled={!state.brushLibrary.some(item => item.kind === 'brush') && !state.docBrushes.some(item => item.kind === 'brush')}
        onClick={() => exportBrushes(true)}>{t('brush.exportLibrary')}</Button>
      <Button disabled={!b} onClick={() => void exportBrushPng()}>{t('brush.exportPng')}</Button>
    </>}
  </>;
}
