import { createElement, useLayoutEffect, useRef, type FC, type PropsWithChildren } from 'react';
import { effect } from '@preact/signals-react';
import '@pixprite/ui/elements';
import type { PxVariables } from '@pixprite/ui/elements';
import { getValue } from '~/utils/signals';
export type VariablesProps = Record<string, any> & PropsWithChildren;
export const Variables: FC<VariablesProps> = ({ children, ...props }) => {
  const ref = useRef<PxVariables>(null);
  useLayoutEffect(() => effect(() => {
    if (ref.current) ref.current.variables = Object.fromEntries(Object.entries(props).map(([name, value]) => [name, getValue(value)]));
  }));
  return createElement('px-variables', { ref }, children);
};
