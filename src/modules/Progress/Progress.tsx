import { busy } from "~/core/Work";
import { t } from "~/core/i18n";
import { Button } from "~/ui/Button";
import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";
import styled from "styled-components";

const Shade = styled.div`
  position: absolute;
  inset: 0;
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--backdrop);
`;

const Box = styled.div`
  min-width: 260px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite);
`;

const Bar = styled.div`
  height: 8px;
  background: var(--field);
  border: 1px solid var(--b1);
  overflow: hidden;

  & > div { height: 100%; background: var(--accent); transition: width .1s; }
  &[data-unknown=true] > div { width: 30% !important; animation: progress-slide 1s linear infinite; }

  @keyframes progress-slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
`;

export const ProgressOverlay: FC = () => {
  useSignals();
  const b = busy.value;
  if (!b) return null;
  const known = b.progress >= 0;
  return (
    <Shade onPointerDown={e => e.stopPropagation()}>
      <Box role="alertdialog" aria-busy="true">
        <div>{b.label}{known && ` — ${Math.round(b.progress * 100)}%`}</div>
        <Bar data-unknown={!known}><div style={{ width: `${Math.round(Math.max(0, b.progress) * 100)}%` }} /></Bar>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={b.cancel}>{t('common.cancel')}</Button>
        </div>
      </Box>
    </Shade>
  );
};
