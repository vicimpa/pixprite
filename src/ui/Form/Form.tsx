/** Editor data and localization adapter for the shared declarative form. */
import { state } from "~/core/State";
import type { FormSchema, FormValues } from "@pixprite/api";
import { useSignals } from "@preact/signals-react/runtime";
import { createElement, useLayoutEffect, useRef, type FC } from "react";
import "@pixprite/ui/elements";
import { formDefaults, type PxFormElement } from "@pixprite/ui/elements";

export { formDefaults };
export type FormProps = {
  schema: FormSchema;
  values: FormValues;
  onChange: (values: FormValues) => void;
  /** Translates a manifest string (`%key%` or plain). */
  label?: (text: string) => string;
  /** One row (tool options bar) instead of a column of rows. */
  inline?: boolean;
};

export const Form: FC<FormProps> = ({ schema, values, onChange, label = text => text, inline }) => {
  useSignals();
  const ref = useRef<PxFormElement>(null);
  const resolved = schema.map(field => ({
    ...field,
    label: label(field.label),
    options: field.type === 'layer' ? state.sprite.layers.map((layer, value) => ({ value, label: layer.name }))
      : field.type === 'tag' ? state.sprite.tags.map((tag, value) => ({ value, label: tag.name }))
      : field.options?.map(option => ({ ...option, label: label(option.label) })),
  }));
  const palette = state.palette;
  useLayoutEffect(() => {
    const element = ref.current!;
    element.inline = !!inline; element.palette = palette; element.values = values; element.schema = resolved;
    const changed = (event: Event) => { if (event.target === element) onChange((event as CustomEvent<FormValues>).detail); };
    element.addEventListener('valuechange', changed);
    return () => element.removeEventListener('valuechange', changed);
  });
  return createElement('px-form', { ref });
};
