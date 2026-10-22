import type { FC } from "react";
import styled from "styled-components";

const Handle = styled.div<{ $vertical: boolean; }>`
  flex-shrink: 0;
  background-color: var(--bg);
  ${p => p.$vertical ? 'width: 4px; cursor: col-resize;' : 'height: 4px; cursor: row-resize;'}

  &:hover, &[data-drag=true] {
    background-color: var(--sel);
  }
`;

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

export const Splitter: FC<SplitterProps> = ({ vertical, value, dir, min = 60, max = 800, onChange }) => (
  <Handle
    $vertical={vertical}
    onPointerDown={e => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      el.dataset.drag = 'true';
      const start = vertical ? e.clientX : e.clientY;
      const move = (e: PointerEvent) => {
        const delta = (vertical ? e.clientX : e.clientY) - start;
        onChange(Math.max(min, Math.min(max, Math.round(value + delta * dir))));
      };
      const up = () => {
        el.dataset.drag = 'false';
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    }}
  />
);
