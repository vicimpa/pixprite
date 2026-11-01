import "@pixprite/ui/elements";
import { createElement, useLayoutEffect, useRef, type FC } from "react";
import { type PxSplitterElement } from "@pixprite/ui/elements";

export type SplitterProps = {
  /** true: drags horizontally (between columns) */
  vertical: boolean;
  value: number;
  /** -1 when the panel grows as the handle moves left/up */
  dir: 1 | -1;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
};

export const Splitter: FC<SplitterProps> = ({ vertical, value, dir, min = 60, max = 800, onChange }) => {
  const ref = useRef<PxSplitterElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    Object.assign(element, { vertical, value, growth: dir, min, max });
    const change = () => onChange(element.value);
    element.addEventListener('change', change);
    return () => element.removeEventListener('change', change);
  });
  return createElement('px-splitter', { ref, 'data-splitter': vertical ? 'columns' : 'rows' });
};
