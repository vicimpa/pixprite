/**
 * Problems window: what extension validators report about the active sprite.
 * Clicking a problem jumps to its layer / frame; "Check again" reruns every validator.
 */

import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { extensionsHost } from "~/modules/Extensions/bridge";
import type { Problem } from "~/modules/Extensions/types";
import { Button, Muted } from "~/ui/Button";
import { Dialog, openDialog } from "~/ui/Dialog";
import { useSignals } from "@preact/signals-react/runtime";
import { useState, type FC } from "react";
import styled from "styled-components";
import { VirtualList } from "~/ui/VirtualList";

const List = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 120px;
  max-height: 50vh;
  overflow: auto;
  border: 1px solid var(--b1);
  background-color: var(--field);
`;

const Item = styled.button`
  display: flex;
  width: 100%;
  gap: 6px;
  align-items: baseline;
  padding: 3px 6px;
  font: inherit;
  color: var(--fg);
  text-align: start;
  background: transparent;
  border: none;
  cursor: pointer;
  & + & { border-top: 1px solid var(--b2); }
  &:hover { background-color: var(--sel); color: var(--sel-fg); }
  & > b { flex-shrink: 0; min-width: 1em; }
  &[data-severity=error] > b { color: var(--danger); }
  &[data-severity=warning] > b { color: var(--accent); }
`;

const MARK = { error: '×', warning: '!', info: 'i' } as const;

/** Moves the editor to where a problem is */
function reveal(p: Problem) {
  const s = state.sprite;
  const at = p.at;
  if (!at) return;
  if (at.layer !== undefined && at.layer < s.layers.length) s.layer = at.layer;
  if (at.frame !== undefined && at.frame < s.frames.length) s.frame = at.frame;
  else if (at.tag !== undefined && s.tags[at.tag]) s.frame = s.tags[at.tag].from;
}

export function problemCount() {
  return extensionsHost.value?.problems.value.reduce((n, g) => n + g.problems.length, 0) ?? 0;
}

const ProblemsWindow: FC<{ close: () => void; }> = ({ close }) => {
  useSignals();
  const host = extensionsHost.value;
  const [busy, setBusy] = useState(false);
  const groups = host?.problems.value ?? [];
  const all = groups.flatMap(g => g.problems.map(p => ({ ...p, ext: g.ext })));
  const order = { error: 0, warning: 1, info: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <Dialog title={t('problems.title')} onClose={close} cancelLabel={t('common.close')} width={440}
      extraButtons={host && <Button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await host.runValidators(); } finally { setBusy(false); }
      }}>{t('problems.checkAgain')}</Button>}>
      <List>
        {!all.length && <Muted style={{ padding: 8 }}>{busy ? t('problems.checking') : t('problems.none')}</Muted>}
        <VirtualList measurementKey={`${state.ui.font}:${state.prefs.uiFont}`} items={all} itemKey={(_, i) => i} estimate={state.ui.row} maxHeight="50vh" render={(p, i) => (
          <Item key={i} type="button" data-severity={p.severity} title={t(`problems.severity.${p.severity}`)} onClick={() => reveal(p)}>
            <b>{MARK[p.severity]}</b>
            <span style={{ flex: '1 1 auto' }}>{p.message}</span>
            <Muted>{host?.label(p.ext, host.installed.value.find(e => e.manifest.id === p.ext)?.manifest.name) || p.ext}</Muted>
          </Item>
        )} />
      </List>
    </Dialog>
  );
};

export function openProblems() {
  openDialog(close => <ProblemsWindow close={close} />);
}
