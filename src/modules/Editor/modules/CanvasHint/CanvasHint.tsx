import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { toolDef } from "~/core/Tools";
import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";
import styled from "styled-components";

/** A single quiet line; readable over any canvas thanks to the shadow */
const Line = styled.div`
  position: absolute;
  right: 10px;
  bottom: 6px;
  z-index: 4;
  max-width: calc(100% - 20px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--fg-dim);
  font-size: calc(var(--font-size) * .9);
  text-shadow: 0 1px 2px var(--workspace), 0 0 3px var(--workspace);
  pointer-events: none;
`;

/** How to use the current tool, in the bottom-right corner of the canvas */
export const CanvasHint: FC = () => {
  useSignals();
  if (state.sprite.effectsBoundsNotice) return <Line role="alert">{t('dialog.layerFX.bypassed')}</Line>;
  const notice = state.sprite.historyLimitNotice;
  if (notice) return <Line role="status">{t(notice === 'operation' ? 'dialog.history.operationExceeded' : 'dialog.history.memoryExceeded')}</Line>;
  if (!state.prefs.showHints || state.playing) return null;
  return <Line>{t(toolDef(state.activeTool).hint)}</Line>;
};
