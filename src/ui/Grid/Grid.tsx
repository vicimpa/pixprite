import { createElement, type FC } from 'react';
import '@pixprite/ui/elements';
import type { CanvasProps } from '~/ui/Canvas';

export type GridProps = { size?: number; dark?: string; light?: string } & Omit<CanvasProps, 'draw' | 'loop'>;
export const Grid: FC<GridProps> = ({ size, dark, light, inset, hidpi, ...props }) => createElement('px-grid-pattern', {
  ...props, size, dark, light, inset: inset ? '' : undefined, hidpi: hidpi ? '' : undefined,
});
