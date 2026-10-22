import { english, t } from "~/core/i18n";
import { COMMANDS, bindKey, commandForCombo, commandKey, commandLabel, resetKeys, unbindKey } from "~/core/Commands";
import { comboOf, prettyCombo } from "~/core/Hotkeys";
import { Button, Input, Muted } from "~/ui/Button";
import { Dialog, openDialog, Section } from "~/ui/Dialog";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";

const List = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 60vh;
  min-width: 520px;
  overflow-y: auto;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border-bottom: 1px dotted var(--b2);

  & > span:first-child { flex-grow: 1; }
`;

const Key = styled.button`
  font: inherit;
  color: var(--fg);
  background: var(--field);
  border: 1px solid var(--b2);
  padding: 0 6px;
  cursor: pointer;

  &:hover { border-color: var(--danger); text-decoration: line-through; }
`;

const Capture = styled.span`
  color: var(--accent);
`;

/** Shortcut editor: search, click + to record a combo, click a key to remove it */
const ShortcutEditor: FC<{ close: () => void; }> = ({ close }) => {
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); setPending(null); return; }
      setPending(comboOf(e));
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [recording]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = COMMANDS.filter(c => words.every(w => `${commandLabel(c)} ${c.label ?? english(commandKey(c.id))} ${t(c.group)} ${english(c.group)} ${(c.keys ?? []).join(' ')}`.toLowerCase().includes(w)));
  const groups = [...new Set(visible.map(c => c.group))];
  const conflict = recording && pending ? commandForCombo(pending, recording) : null;

  return (
    <Dialog title={t('common.keyboardShortcuts')} onClose={close} cancelLabel={t('common.close')} width={640}
      extraButtons={<Button type="button" onClick={() => { resetKeys(); redraw(n => n + 1); }}>{t('dialog.shortcutEditor.resetAll')}</Button>}>
      <Input placeholder={t('dialog.shortcutEditor.searchCommandsOrKeys')} value={query} style={{ width: '100%' }} onChange={e => setQuery(e.target.value)} />
      <List>
        {groups.map(g => (
          <div key={g}>
            <Section>{t(g)}</Section>
            {visible.filter(c => c.group === g).map(c => (
              <Item key={c.id}>
                <span>{commandLabel(c)}</span>
                {c.keys?.map(k => (
                  <Key key={k} type="button" title={t('dialog.shortcutEditor.clickToRemove')} onClick={() => { unbindKey(c.id, k); redraw(n => n + 1); }}>{prettyCombo(k)}</Key>
                ))}
                {recording === c.id ? <>
                  <Capture>{pending ? prettyCombo(pending) : 'Press keys…'}</Capture>
                  {conflict && <Muted>(now: {commandLabel(conflict)})</Muted>}
                  <Button type="button" disabled={!pending} onClick={() => { bindKey(c.id, pending!); setRecording(null); setPending(null); }}>{t('dialog.shortcutEditor.set')}</Button>
                  <Button type="button" onClick={() => { setRecording(null); setPending(null); }}>{t('common.cancel')}</Button>
                </> : (
                  <Button type="button" $square title={t('dialog.shortcutEditor.addAShortcut')} onClick={() => { setRecording(c.id); setPending(null); }}>+</Button>
                )}
              </Item>
            ))}
          </div>
        ))}
      </List>
      <Muted>{t('dialog.shortcutEditor.toolsPressATool')}</Muted>
    </Dialog>
  );
};

export const openShortcuts = () => openDialog(close => <ShortcutEditor close={close} />);
