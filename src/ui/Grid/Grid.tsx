import { Canvas, type CanvasProps } from "$ui/Canvas";
import { useMemo, type FC, type JSX } from "react";
import { Grid as GridPattern } from "$core/Grid";

export type GridProps = {
  size?: number;
  dark?: string;
  light?: string;
} & Omit<CanvasProps, 'draw' | 'loop'>;

export const Grid: FC<GridProps> = ({ size, dark, light, ...props }) => {
  const grid = useMemo(() => new GridPattern(size, dark, light), [size, dark, light]);

  return (
    <Canvas
      draw={({ width, height }, ctx) => {
        ctx.fillStyle = grid.pattern;
        ctx.fillRect(0, 0, width, height);
      }} {...props} />
  );
};