/**
 * Declarative form: renders a FormSchema (from an extension manifest or `ctx.ui.showForm`) with
 * the app's own controls. Labels arrive already resolved (`%key%` is translated by the caller
 * through `label`), so the same renderer serves tool options, filters and extension settings.
 */

import { state } from "~/core/State";
import type { FormField, FormSchema, FormValue, FormValues } from "@pixprite/api";
import { Check, Input, Label, Range, Select } from "~/ui/Button";
import { ColorInput } from "~/ui/ColorInput";
import { FieldLabel, Row } from "~/ui/Dialog";
import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";

/** Value a field starts with when the schema gives none */
function fallback(f: FormField): FormValue {
  switch (f.type) {
    case 'slider': case 'number': return f.min ?? 0;
    case 'color': return '#000000';
    case 'checkbox': return false;
    case 'select': return f.options?.[0]?.value ?? '';
    case 'layer': case 'tag': return 0;
    default: return '';
  }
}

export function formDefaults(schema: FormSchema, values: FormValues = {}): FormValues {
  return Object.fromEntries(schema.map(f => [f.key, values[f.key] ?? f.default ?? fallback(f)]));
}

const clamp = (f: FormField, n: number) => Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, n));

export type FormProps = {
  schema: FormSchema;
  values: FormValues;
  onChange: (values: FormValues) => void;
  /** Translates a manifest string (`%key%` or plain) */
  label?: (text: string) => string;
  /** One row (tool options bar) instead of a column of rows (dialogs) */
  inline?: boolean;
};

export const Form: FC<FormProps> = ({ schema, values, onChange, label = s => s, inline }) => {
  useSignals();
  const set = (key: string, v: FormValue) => onChange({ ...values, [key]: v });

  const control = (f: FormField) => {
    const v = values[f.key] ?? f.default ?? fallback(f);
    switch (f.type) {
      case 'slider': return <>
        <Range min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(v)}
          onChange={e => set(f.key, Number(e.target.value))} />
        <Input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(v)}
          onChange={e => set(f.key, clamp(f, Number(e.target.value) || 0))} />
      </>;
      case 'number': return <Input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(v)}
        style={{ width: '5em' }} onChange={e => set(f.key, clamp(f, Number(e.target.value) || 0))} />;
      case 'color': return <ColorInput value={String(v)} onChange={hex => set(f.key, hex)} />;
      case 'checkbox': return <Check checked={!!v} onChange={e => set(f.key, e.target.checked)} />;
      case 'select': return (
        <Select value={String(v)} onChange={e => {
          const o = f.options?.find(o => String(o.value) === e.target.value);
          set(f.key, o ? o.value : e.target.value);
        }}>
          {f.options?.map(o => <option key={String(o.value)} value={String(o.value)}>{label(o.label)}</option>)}
        </Select>
      );
      case 'layer': return (
        <Select value={String(v)} onChange={e => set(f.key, Number(e.target.value))}>
          {state.sprite.layers.map((l, i) => <option key={i} value={String(i)}>{l.name}</option>)}
        </Select>
      );
      case 'tag': return (
        <Select value={String(v)} onChange={e => set(f.key, Number(e.target.value))}>
          {state.sprite.tags.map((tg, i) => <option key={i} value={String(i)}>{tg.name}</option>)}
        </Select>
      );
      default: return <Input value={String(v)} style={{ width: '12em' }} onChange={e => set(f.key, e.target.value)} />;
    }
  };

  const fields = schema.map(f => f.type === 'checkbox'
    ? <Label key={f.key}>{control(f)}{label(f.label)}</Label>
    : <Row key={f.key}>{inline ? <span>{label(f.label)}</span> : <FieldLabel>{label(f.label)}</FieldLabel>}{control(f)}</Row>);

  return inline
    ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{fields}</div>
    : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{fields}</div>;
};
