import type { FC } from "react";
import styled from "styled-components";
import { trackPointer } from "~/ui/trackPointer";

const Handle = styled.div<{ $vertical: boolean; }>`
  flex-shrink: 0;
  touch-action: none;
  user-select: none;
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
    data-splitter={vertical ? 'columns' : 'rows'}
    onPointerDown={e => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const panel = (dir === 1 ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null;
      if (!panel) return;
      const property = vertical ? 'width' : 'height';
      let latest = value;
      el.dataset.drag = 'true';
      trackPointer(e, (dx, dy) => {
        const next = Math.max(min, Math.min(max, Math.round(value + (vertical ? dx : dy) * dir)));
        if (next === latest) return;
        latest = next;
        panel.style[property] = `${next}px`;
      }, () => {
        el.dataset.drag = 'false';
        if (latest !== value) onChange(latest);
      });
    }}
  />
);
