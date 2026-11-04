import { t } from '~/core/i18n';
import { pixelRatio } from '~/core/PixelRatio';
import { Select } from '~/ui/Button';
import { Field, NumberField } from './fields';

const RATIOS = ['1:1', '2:1', '1:2', '4:5', '8:7'];
export function PixelRatioField({ value, onChange }: { value: [string, string]; onChange(value: [string, string]): void }) {
  const key = value.join(':');
  return <>
    <Field label={t('pixelRatio.title')}>
      <Select value={RATIOS.includes(key) ? key : 'custom'} onChange={e => {
        if (e.target.value !== 'custom') onChange(e.target.value.split(':') as [string, string]);
      }}>
        {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
        <option value="custom">{t('pixelRatio.custom')}</option>
      </Select>
    </Field>
    <NumberField label={t('pixelRatio.width')} value={value[0]} onChange={v => onChange([v, value[1]])} min={1} max={255} />
    <NumberField label={t('pixelRatio.height')} value={value[1]} onChange={v => onChange([value[0], v])} min={1} max={255} />
  </>;
}
export function ratioValue(value: [string, string]): [number, number] {
  const [x, y] = value.map(v => Math.max(1, Math.min(255, Math.trunc(Number(v) || 1))));
  return pixelRatio(x, y);
}
