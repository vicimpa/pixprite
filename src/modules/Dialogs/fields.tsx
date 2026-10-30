import { Input, Muted } from "~/ui/Button";
import { FieldLabel, Row } from "~/ui/Dialog";
import type { FC, ReactNode } from "react";

/** Last used dialog values, remembered between sessions */
export function loadDialogPrefs<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pixprite:dialog:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

export function saveDialogPrefs(key: string, value: unknown) {
  try { localStorage.setItem(`pixprite:dialog:${key}`, JSON.stringify(value)); } catch { }
}

export const num = (v: string, fallback: number) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const Field: FC<{ label: string; children: ReactNode; }> = ({ label, children }) => (
  <Row><FieldLabel>{label}</FieldLabel>{children}</Row>
);

export const NumberField: FC<{ label: string; value: string; onChange: (v: string) => void; suffix?: string; min?: number; max?: number; step?: number; width?: number; }> =
  ({ label, value, onChange, suffix, min, max, step, width }) => (
    <Field label={label}>
      <Input type="number" value={value} min={min} max={max} step={step} style={{ width: width ?? 56 }}
        onChange={e => onChange(e.target.value)} />
      {suffix && <Muted>{suffix}</Muted>}
    </Field>
  );

