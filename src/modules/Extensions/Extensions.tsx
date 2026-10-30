/**
 * Extensions window: installed list (enable / disable / reload / remove), the store backed by a
 * registry.json, and dev mode (load an unpacked extension from a local dev server).
 * Installing shows the permissions the extension asks for and needs an explicit yes.
 */

import { formatNumber, t } from "~/core/i18n";
import { state } from "~/core/State";
import { Button, Check, Input, Label, Muted } from "~/ui/Button";
import { askConfirm, Dialog, openDialog, Row, Section } from "~/ui/Dialog";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";
import { extensionsHost, type InstalledExtension } from "./bridge";
import type { Registry } from "./types";
import { applyAllUpdates, applyUpdate, catalogUrls, checkUpdates, loadCatalogs, localized, matches, newer, updates, type Catalog, type CatalogEntry } from "./updates";

const DEV_KEY = 'pixprite.extensions.dev';

// Per-viewer conveniences only; the store works without them
const recall = (key: string, fallback: string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { } };

import { confirmInstall } from "./permissions";
export { confirmInstall, permissionText } from "./permissions";

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 120px;
  max-height: 50vh;
  overflow: auto;
  border: 1px solid var(--b1);
  background-color: var(--field);
  padding: 2px;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  & + & { border-top: 1px solid var(--b2); }
  & > div { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  & img { width: 24px; height: 24px; image-rendering: pixelated; flex-shrink: 0; }
`;

const Tabs = styled.div`
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--b2);
`;

const Status = styled.span`
  &[data-status=failed] { color: var(--danger); }
  &[data-status=active] { color: var(--accent); }
`;

const Icon: FC<{ ext: string; path?: string; }> = ({ ext, path }) => {
  const host = extensionsHost.value;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!host || !path) return;
    let alive = true;
    host.fileUrl(ext, path).then(u => alive && setSrc(u), () => { });
    return () => { alive = false; };
  }, [host, ext, path]);
  return src ? <img src={src} alt="" /> : <span style={{ width: 24, flexShrink: 0 }} />;
};

const Installed: FC = () => {
  useSignals();
  const host = extensionsHost.value!;
  const list = host.installed.value;
  const act = (fn: () => Promise<unknown>) => fn().catch(e => state.showTip(String(e?.message ?? e), 4000));

  const [busy, setBusy] = useState<string | null>(null);
  const update = (id: string | null) => {
    setBusy(id ?? '*');
    act(() => id ? applyUpdate(id) : applyAllUpdates()).finally(() => setBusy(null));
  };
  const pending = updates.value;

  if (!list.length) return <List><Muted style={{ padding: 8 }}>{t('extensions.noneInstalled')}</Muted></List>;
  return <>
    <Row>
      <Button type="button" disabled={busy !== null} onClick={() => { setBusy('check'); checkUpdates().finally(() => setBusy(null)); }}>
        {busy === 'check' ? t('extensions.loading') : t('extensions.checkUpdates')}
      </Button>
      {pending.size > 0 && <Button type="button" disabled={busy !== null} onClick={() => update(null)}>{t('extensions.updateAll', { count: pending.size })}</Button>}
    </Row>
    <List>
      {list.map((e: InstalledExtension) => {
        const m = e.manifest;
        return (
          <Item key={m.id}>
            <Icon ext={m.id} path={m.icon} />
            <div>
              <span>{host.label(m.id, m.name)} <Muted>{m.version}{e.devUrl ? ` · ${t('extensions.dev')}` : ''}</Muted></span>
              {m.description && <Muted style={{ whiteSpace: 'normal' }}>{host.label(m.id, m.description)}</Muted>}
              <Status data-status={e.status}>{t(`extensions.status.${e.status}`)}{e.error ? `: ${e.error}` : ''}</Status>
            </div>
            <Label title={t('extensions.enabled')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              <Check checked={e.enabled} onChange={ev => act(() => host.setEnabled(m.id, ev.target.checked))} />
              {t('extensions.enabled')}
            </Label>
            {e.devUrl && <Button type="button" onClick={() => act(() => host.reload(m.id))}>{t('extensions.reload')}</Button>}
            {pending.has(m.id) && <Button type="button" disabled={busy !== null} onClick={() => update(m.id)}>
              {busy === m.id || busy === '*' ? t('extensions.loading') : t('extensions.updateTo', { version: pending.get(m.id)!.entry.version })}
            </Button>}
            <Button type="button" onClick={async () => {
              if (await askConfirm(t('extensions.uninstallQuestion', { name: host.label(m.id, m.name) }), { ok: t('extensions.uninstall') }))
                act(() => host.uninstall(m.id));
            }}>{t('extensions.uninstall')}</Button>
          </Item>
        );
      })}
    </List>
  </>;
};

const Store: FC = () => {
  useSignals();
  const host = extensionsHost.value!;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(''); setCatalog(null);
    const c = await loadCatalogs();
    setCatalog(c);
    void checkUpdates(false, c);
  };
  useEffect(() => { load(); }, []);

  const installed = new Map(host.installed.value.map(e => [e.manifest.id, e.manifest.version]));
  const install = async (entry: CatalogEntry) => {
    if (!await confirmInstall(localized(entry).name, entry.permissions ?? [])) return;
    setBusy(entry.id);
    try { await host.install(entry, entry.registry); void checkUpdates(false, catalog ?? undefined); }
    catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };
  const shown = catalog?.entries.filter(e => matches(e, query));

  return <>
    <Row>
      <Input value={query} placeholder={t('extensions.search')} style={{ flex: '1 1 auto', width: 'auto' }} autoFocus
        onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
      <Button type="button" onClick={() => load()}>{t('extensions.refresh')}</Button>
    </Row>
    {catalog?.errors.map(e => <span key={e.url} style={{ color: 'var(--danger)', whiteSpace: 'normal' }}>{t('extensions.registryFailed', { error: `${e.url}: ${e.error}` })}</span>)}
    {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    <List>
      {!catalog && <Muted style={{ padding: 8 }}>{t('extensions.loading')}</Muted>}
      {catalog && !catalog.entries.length && <Muted style={{ padding: 8 }}>{t('extensions.registryEmpty')}</Muted>}
      {catalog && catalog.entries.length > 0 && !shown?.length && <Muted style={{ padding: 8 }}>{t('extensions.nothingFound')}</Muted>}
      {shown?.map(entry => {
        const have = installed.get(entry.id);
        const { name, description } = localized(entry);
        return (
          <Item key={entry.id}>
            <span style={{ width: 24, flexShrink: 0 }} />
            <div>
              <span>{name} <Muted>{entry.version}</Muted></span>
              {description && <Muted style={{ whiteSpace: 'normal' }}>{description}</Muted>}
              {entry.completeness !== undefined &&
                <Muted>{t('extensions.completeness', { percent: formatNumber(typeof entry.completeness === 'number' ? entry.completeness : Math.max(...Object.values(entry.completeness)), { maximumFractionDigits: 1 }) })}</Muted>}
              {catalogUrls().length > 1 && <Muted title={entry.registry}>{new URL(entry.registry).host || entry.registry}</Muted>}
            </div>
            {have && !newer(entry.version, have)
              ? <Muted>{t('extensions.installed')}</Muted>
              : <Button type="button" disabled={busy !== null} onClick={() => have ? applyUpdate(entry.id) : install(entry)}>
                {busy === entry.id ? t('extensions.loading') : have ? t('extensions.update') : t('extensions.install')}
              </Button>}
          </Item>
        );
      })}
    </List>
  </>;
};

const Dev: FC = () => {
  const host = extensionsHost.value!;
  const [url, setUrl] = useState(() => recall(DEV_KEY, 'http://localhost:5174'));
  const [message, setMessage] = useState('');
  const load = async () => {
    setMessage('');
    const base = url.replace(/\/?$/, '/');
    try {
      // The server root lists every extension it builds: connect them all
      const reg = await fetch(new URL('registry.json', base)).then(r => r.ok ? r.json() as Promise<Registry> : null).catch(() => null);
      const ids = reg ? (Array.isArray(reg) ? reg : reg.extensions ?? []).map(e => e.path ?? e.id) : [];
      const names: string[] = [];
      if (ids.length) for (const path of ids) { const m = await host.loadDev(new URL(path.replace(/\/?$/, '/'), base).href); names.push(host.label(m.id, m.name)); }
      else { const m = await host.loadDev(base); names.push(host.label(m.id, m.name)); }
      remember(DEV_KEY, url);
      setMessage(t('extensions.devLoaded', { name: names.join(', ') }));
    } catch (e) { setMessage(String((e as Error)?.message ?? e)); }
  };
  return <>
    <span>{t('extensions.devHint')}</span>
    <Row>
      <Input value={url} style={{ flex: '1 1 auto', width: 'auto' }} onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); load(); } }} />
      <Button type="button" onClick={load}>{t('extensions.load')}</Button>
    </Row>
    {message && <span>{message}</span>}
  </>;
};

type Tab = 'installed' | 'store' | 'dev';

const ExtensionsWindow: FC<{ close: () => void; tab: Tab; }> = ({ close, tab: initial }) => {
  useSignals();
  const [tab, setTab] = useState<Tab>(initial);
  const host = extensionsHost.value;
  return (
    <Dialog title={t('extensions.title')} onClose={close} cancelLabel={t('common.close')} width={520}>
      {!host ? <span>{t('extensions.unavailable')}</span> : <>
        <Tabs>
          {(['installed', 'store', 'dev'] as Tab[]).map(id => (
            <Button key={id} type="button" $active={tab === id} onClick={() => setTab(id)}>{t(`extensions.tab.${id}`)}</Button>
          ))}
        </Tabs>
        <Section>{t(`extensions.tab.${tab}`)}</Section>
        {tab === 'installed' && <Installed />}
        {tab === 'store' && <Store />}
        {tab === 'dev' && <Dev />}
      </>}
    </Dialog>
  );
};

export function openExtensions(tab: Tab = 'installed') {
  return openDialog(close => <ExtensionsWindow close={close} tab={tab} />);
}
