import { useEffect, useState, type FC } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import styled from 'styled-components';
import type { McpState } from '../../../desktop/protocol';
import { t } from '~/core/i18n';
import { Button, Check, Input, Label, Muted, sunken } from '~/ui/Button';
import { Dialog, openDialog, Row, Section } from '~/ui/Dialog';

const Hint = styled(Muted)`white-space: normal; line-height: 1.5;`;
const Code = styled.textarea`
  ${sunken}
  color: var(--fg);
  width: 100%;
  box-sizing: border-box;
  min-height: 220px;
  padding: 10px;
  font: 12px/1.5 monospace;
  resize: vertical;
  white-space: pre;
  user-select: text;
  -webkit-user-select: text;
`;
const Path = styled(Input)`flex: 1; min-width: 0; width: 100%;`;

const Mcp: FC<{ close: () => void }> = ({ close }) => {
  useSignals();
  const bridge = window.pixpriteDesktop;
  const [info, setInfo] = useState<McpState>();
  const [busy, setBusy] = useState(!!bridge?.mcp);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [port, setPort] = useState('3356');

  useEffect(() => {
    if (!bridge?.mcp) return;
    let disposed = false;
    bridge.mcp().then(value => { if (!disposed) { setInfo(value); setPort(String(value.port)); } })
      .catch(reason => { if (!disposed) setError(String(reason)); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [bridge]);

  const refresh = async (enabled?: boolean, nextPort?: number) => {
    if (!bridge?.mcp) return;
    setBusy(true); setError(''); setCopied(false);
    try { const value = await bridge.mcp(enabled, nextPort); setInfo(value); setPort(String(value.port)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const config = info?.url && info.token ? JSON.stringify({ mcpServers: { pixprite: {
    url: info.url,
    headers: { Authorization: `Bearer ${info.token}` },
  } } }, null, 2) : '';
  const validPort = /^\d+$/.test(port) && Number(port) <= 65535;


  return <Dialog title={t('dialog.mcp.title')} onClose={close} width={600}
    onSubmit={() => {}} submitLabel={t('dialog.preferences.done')} cancelLabel={null}>
    <Hint>{t('dialog.mcp.description')}</Hint>
    {!bridge?.mcp ? <Hint>{t('dialog.mcp.desktopOnly')}</Hint> : <>
      <Label><Check checked={info?.enabled ?? false} disabled={busy || !info}
        onChange={event => { void refresh(event.target.checked); }} /> {t('dialog.mcp.enabled')}</Label>
      <Row style={{ flexWrap: 'wrap' }}>
        <span role="status">{busy ? t('dialog.mcp.loading') : info?.running
          ? t('dialog.mcp.running') : info?.enabled && !info.blocked ? t('dialog.mcp.stopped') : t('dialog.mcp.disabled')}</span>
        <Button type="button" disabled={busy} onClick={() => { void refresh(info?.enabled && !info.running && !info.blocked ? true : undefined); }}>
          {t('dialog.mcp.refresh')}
        </Button>
      </Row>
      {(error || info?.error) && <Hint role="alert">{error || info?.error}</Hint>}
      {info && <>
        {info.forced && <Hint>{t('dialog.mcp.forced')}</Hint>}
        {info.blocked && <Hint>{t('dialog.mcp.blocked')}</Hint>}
        <Label>{t('dialog.mcp.port')}<Path type="number" min={0} max={65535} value={port} style={{ maxWidth: 100 }} onChange={event => setPort(event.target.value)} />
          <Button type="button" disabled={busy || !validPort || Number(port) === info.port} onClick={() => { void refresh(undefined, Number(port)); }}>{t('dialog.mcp.applyPort')}</Button>
        </Label>
        <Hint>{t('dialog.mcp.portHint')}</Hint>
        {info.url && <Label>{t('dialog.mcp.address')}<Path readOnly value={info.url} /></Label>}
        <Section>{t('dialog.mcp.clientSetup')}</Section>
        <Hint>{t('dialog.mcp.setupHint')}</Hint>
        {config ? <>
        <Code aria-label={t('dialog.mcp.configuration')} value={config} readOnly spellCheck={false} />
        <Row><Button type="button" onClick={async () => {
          setError(''); setCopied(false);
          try {
            if (bridge.copyText) await bridge.copyText(config);
            else await navigator.clipboard.writeText(config);
            setCopied(true);
          }
          catch { setError(t('dialog.mcp.copyFailed')); }
        }}>{t('dialog.mcp.copy')}</Button>
          {copied && <span role="status">{t('dialog.mcp.copied')}</span>}
        </Row>
        </> : !info.blocked && <Hint>{t('dialog.mcp.enableToConnect')}</Hint>}
        <Hint>{t('dialog.mcp.restartHint')}</Hint>
        <Section>{t('dialog.mcp.connectionFile')}</Section>
        <Path aria-label={t('dialog.mcp.connectionFile')} readOnly value={info.connectionFile} title={info.connectionFile} />
        <Hint>{t('dialog.mcp.localHint')}</Hint>
      </>}
    </>}
  </Dialog>;
};

export const openMcp = () => openDialog(close => <Mcp close={close} />);
