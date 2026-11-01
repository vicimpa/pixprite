export type FormValue = string | number | boolean;
export type FormValues = Record<string, FormValue>;
/** Structural schema shared with the extension API, with resolved labels/options. */
export type FormField = {
  key: string;
  type: 'slider' | 'number' | 'color' | 'select' | 'checkbox' | 'text' | 'layer' | 'tag';
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  default?: FormValue;
};
export type FormSchema = FormField[];

export function fieldDefault(field: FormField): FormValue {
  switch (field.type) {
    case 'slider': case 'number': return field.min ?? 0;
    case 'color': return '#000000';
    case 'checkbox': return false;
    case 'select': return field.options?.[0]?.value ?? '';
    case 'layer': case 'tag': return 0;
    default: return '';
  }
}
export function formDefaults(schema: FormSchema, values: FormValues = {}): FormValues {
  return Object.fromEntries(schema.map(field => [field.key, values[field.key] ?? field.default ?? fieldDefault(field)]));
}

