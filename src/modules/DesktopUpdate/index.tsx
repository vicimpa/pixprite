import { useEffect, useState } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import styled from 'styled-components';
import { currentLanguage, t } from '~/core/i18n';
import { state } from '~/core/State';
import { Button, bevel } from '~/ui/Button';
import { Icon } from '~/ui/Icon';
import type { UpdateState } from '../../../desktop/update-types';

const Notice = styled.div`
  ${bevel}
  position: fixed;
  top: calc(var(--row) + 12px);
  right: 12px;
  z-index: 900;
  width: max-content;
  max-width: min(440px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 10px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-shadow: 0 6px 24px #0005;
  color: var(--fg);
  > div { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  [role=status] { overflow-wrap: anywhere; }
`;

/** A dismissible release notice floats over the editor; it never changes the workspace height. */
export function DesktopUpdate() {
  useSignals();
  const bridge = window.pixpriteDesktop;
  const language = currentLanguage.value;
  const [update, setUpdate] = useState<UpdateState>();
  const [dismissed, setDismissed] = useState<string>();
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const off = bridge.onUpdate(value => { if (alive) setUpdate(value); });
    void bridge.getUpdate().then(value => { if (alive) setUpdate(value); }).catch(console.error);
    return () => { alive = false; off(); };
  }, [bridge]);
  useEffect(() => { bridge?.setLanguage(language); }, [bridge, language]);
  if (!bridge || !update?.version || !update.url || dismissed === update.version) return null;
  return <Notice data-testid="desktop-update">
    <div>
      <span role="status" aria-live="polite">{t('updates.available', { version: update.version })}</span>
      <Button $primary onClick={() => { void bridge.update('open').catch(() => state.showTip(t('updates.openFailed'), 4000)); }}>{t('updates.openRelease')}</Button>
    </div>
    <Button $square title={t('updates.dismiss')} aria-label={t('updates.dismiss')} onClick={() => setDismissed(update.version)}>
      <Icon name="close" scale="glyph" />
    </Button>
  </Notice>;
}
