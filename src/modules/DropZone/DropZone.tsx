import { t } from "~/core/i18n";
import { isFileDrag } from "~/core/Hotkeys";
import { useSignals } from "@preact/signals-react/runtime";
import { signal } from "@preact/signals-react";
import { useEffect, type FC } from "react";
import styled from "styled-components";

const dragging = signal(false);

const Overlay = styled.div`
  position: fixed;
  inset: 8px;
  z-index: 980;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--font-size) * 1.6);
  color: var(--fg);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 3px dashed var(--accent);
  pointer-events: none;
`;

/** Highlights the window while files are dragged over it (dropping is handled by the hotkeys module) */
export const DropZone: FC = () => {
  useSignals();
  useEffect(() => {
    let depth = 0;
    // Files, or file paths from apps that only pass paths (the drop then explains it)
    const hasFiles = isFileDrag;
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; dragging.value = true; } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; dragging.value = false; } };
    const end = () => { depth = 0; dragging.value = false; };
    addEventListener('dragenter', enter);
    addEventListener('dragleave', leave);
    addEventListener('drop', end);
    addEventListener('dragend', end);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', end);
      removeEventListener('dragend', end);
    };
  }, []);
  return dragging.value ? <Overlay>{t('drop.dropFilesToOpen')}</Overlay> : null;
};
