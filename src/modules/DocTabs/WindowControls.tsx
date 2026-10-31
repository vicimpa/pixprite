import { useEffect, useState } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import type { DesktopBridge, WindowAction, WindowState } from '../../../desktop/protocol';
import { t } from '~/core/i18n';
import { state as editor } from '~/core/State';
import styled from 'styled-components';

const Controls = styled.div`
  position: absolute; inset: 0 0 0 auto;
  display: flex; align-items: stretch;
  -webkit-app-region: no-drag;
  > button {
    width: 36px; padding: 0; display: grid; place-items: center;
    color: var(--fg); background: transparent; border: 0; cursor: default;
  }
  > button:hover { background: var(--face-hot); }
  > button[data-action=close]:hover { background: #c43b45; color: white; }
  > button:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
  &[data-mac=true] { inset: 0 auto 0 0; align-items: center; gap: 7px; padding: 0 10px; }
  &[data-mac=true] > button { width: 14px; height: 14px; border-radius: 50%; color: #231f2b; border: 1px solid #0002; }
  &[data-mac=true] > button[data-action=close] { background: #ff5f57; }
  &[data-mac=true] > button[data-action=minimize] { background: #febc2e; }
  &[data-mac=true] > button[data-action=fullscreen] { background: #28c840; }
  &[data-mac=true][data-focused=false] > button { background: var(--b2); }
  &[data-mac=true] svg { opacity: 0; }
  &[data-mac=true]:hover svg, &[data-mac=true] > button:focus-visible svg { opacity: 1; }
`;

export function WindowControls({ bridge }: { bridge: DesktopBridge }) {
  useSignals();
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false, focused: true });
  useEffect(() => {
    let alive = true;
    const off = bridge.onWindowState(value => { if (alive) setState(value); });
    void bridge.windowState().then(value => { if (alive) setState(value); }).catch(console.error);
    return () => { alive = false; off(); };
  }, [bridge]);
  const mac = bridge.platform === 'darwin';
  const button = (action: WindowAction) => {
    const label = action === 'close' ? t('windowControls.close') : action === 'minimize' ? t('windowControls.minimize')
      : action === 'fullscreen' ? t(state.fullscreen ? 'windowControls.exitFullscreen' : 'windowControls.enterFullscreen')
      : t(state.maximized ? 'windowControls.restore' : 'windowControls.maximize');
    const path = action === 'close' ? 'M3 3l6 6M9 3 3 9' : action === 'minimize' ? 'M2 6h8'
      : action === 'fullscreen' ? 'M2 5V2h3M7 10h3V7M2 2l3 3m2 2 3 3'
      : state.maximized ? 'M4 4h6v6H4zM2 7V2h5' : 'M2 2h8v8H2z';
    return <button key={action} type="button" data-action={action} aria-label={label} title={label}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onClick={() => { void bridge.controlWindow(action).catch(error => editor.showTip(String(error))); }}>
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true"><path d={path} /></svg>
    </button>;
  };
  return <Controls data-testid="window-controls" data-mac={mac} data-focused={state.focused} data-window-controls>
    {(mac ? ['close', 'minimize', 'fullscreen'] as const : ['minimize', 'maximize', 'close'] as const).map(button)}
  </Controls>;
}
