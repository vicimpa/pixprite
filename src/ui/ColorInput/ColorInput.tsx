import "@pixprite/ui/elements";
import { state } from "~/core/State";
import { useSignals } from "@preact/signals-react/runtime";
import { createElement, useLayoutEffect, useRef, type FC } from "react";
import { type PxColorInputElement } from "@pixprite/ui/elements";

/** The editor supplies its palette; the shared element owns the picker. */
export const ColorInput: FC<{ value: string; onChange: (hex: string) => void; title?: string; }> = ({ value, onChange, title }) => {
  useSignals();
  const ref = useRef<PxColorInputElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.value = value; element.palette = state.palette;
    const change = () => onChange(element.value);
    element.addEventListener('change', change);
    return () => element.removeEventListener('change', change);
  });
  return createElement('px-color-input', { ref, title });
};
