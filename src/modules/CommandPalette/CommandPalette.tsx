import { english, t } from "~/core/i18n";
import { available, commandKey, commandLabel, COMMANDS, runCommand, type Command } from "~/core/Commands";
import { prettyCombo } from "~/core/Hotkeys";
import { state } from "~/core/State";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

const SHOWN = 10;

/** Edit distance, stopping early once it exceeds `max` */
function distance(a: string, b: string, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Lower is better; null = no match. Every typed word must appear, or nearly match a word of the label */
function score(c: Command, query: string): number | null {
  // Both the shown (translated) and the English names match
  const label = commandLabel(c).toLowerCase();
  const text = `${label} ${(c.label ?? english(commandKey(c.id))).toLowerCase()} ${t(c.group).toLowerCase()} ${english(c.group).toLowerCase()} ${c.id.toLowerCase()} ${(c.keys ?? []).map(prettyCombo).join(' ').toLowerCase()}`;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const labelWords = label.split(/[^a-z0-9а-я]+/i).filter(Boolean);
  let fuzzy = 0;
  for (const w of words) {
    if (text.includes(w)) continue;
    // A typo or two: one edit for short words, two for longer ones (compared with the word's start)
    const allowed = w.length <= 4 ? 1 : 2;
    if (w.length >= 3 && labelWords.some(lw => distance(w, lw.slice(0, w.length), allowed) <= allowed)) { fuzzy++; continue; }
    return null;
  }
  const q = words.join(' ');
  let s = label === q ? 0 : 10;
  if (label.startsWith(q)) s -= 5;
  else if (labelWords.some(lw => lw.startsWith(words[0] ?? ''))) s -= 2;
  s += fuzzy * 3 + Math.min(5, Math.max(0, label.length - q.length) / 6);
  if (!available(c)) s += 100;
  return s;
}

/** "=" turns the field into a calculator */
function calc(expr: string) {
  if (!/^[-+*/().\d\s%^]+$/.test(expr)) return 'NaN';
  try {
    const v = Function(`"use strict"; return (${expr.replace(/\^/g, '**')});`)() as number;
    return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : 'NaN';
  } catch { return 'NaN'; }
}

const Back = styled.div`
  position: fixed;
  inset: 0;
  z-index: 900;
`;

const Box = styled.div`
  position: absolute;
  left: 50%;
  top: 48px;
  width: min(520px, calc(100vw - 32px));
  transform: translateX(-50%);
  background: var(--bg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 4px 4px 0 var(--shadow);
`;

const Field = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  font: inherit;
  color: var(--fg);
  background: var(--field);
  border: none;
  border-bottom: 1px solid var(--b1);
  outline: none;
`;

const Item = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;

  &[data-active=true] { background: var(--sel); color: var(--sel-fg); }
  &[data-disabled=true] { opacity: .45; }
  & > b { font-weight: normal; flex-grow: 1; }
  & > small { opacity: .7; }
`;

export const CommandPalette: FC = () => {
  useSignals();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = state.commandPalette;

  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => input.current?.focus()); } }, [open]);

  // Esc closes from anywhere (focus may have left the field), and keys return to the field
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        state.commandPalette = false;
      } else if (document.activeElement !== input.current) input.current?.focus();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open]);

  const results = useMemo(() => {
    if (!open || query.startsWith('=')) return [];
    if (!query.trim()) return COMMANDS.filter(c => !c.id.startsWith('nudge') && (!state.home || available(c))).slice(0, 200).map(c => ({ c, s: 0 }));
    return COMMANDS
      .map(c => ({ c, s: score(c, query) }))
      .filter((r): r is { c: Command; s: number; } => r.s !== null)
      .sort((a, b) => a.s - b.s);
  }, [query, open]);

  if (!open) return null;
  const close = () => { state.commandPalette = false; };
  const run = (c: Command) => {
    if (!available(c)) return;
    close();
    runCommand(c.id);
    state.showNotice(commandLabel(c));
  };
  const shown = results.slice(0, SHOWN);

  return createPortal(
    <Back onPointerDown={close}>
      <Box onPointerDown={e => e.stopPropagation()}>
        <Field
          ref={input}
          autoFocus
          value={query}
          placeholder={t('commandPalette.typeACommandCalculates')}
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(shown.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            if (e.key === 'Enter') {
              // A command may open a form; this Enter belongs to the palette, not that form.
              e.preventDefault();
              if (query.startsWith('=')) return close();
              if (shown[active]) run(shown[active].c);
            }
          }} />
        {query.startsWith('=') && <Item><b>{calc(query.slice(1))}</b><small>{t('commandPalette.enterCloses')}</small></Item>}
        {shown.map(({ c }, i) => (
          <Item key={c.id} data-command={c.id} data-active={i === active} data-disabled={!available(c)}
            onPointerEnter={() => setActive(i)} onClick={() => run(c)}>
            {c.checked && <span>{c.checked() ? '✓' : '·'}</span>}
            <b>{commandLabel(c)}</b>
            <small>{t(c.group)}</small>
            {!!c.keys?.length && <small>{c.keys.map(prettyCombo).join(', ')}</small>}
          </Item>
        ))}
        {results.length > SHOWN && <Item data-disabled><small>+{results.length - SHOWN} more</small></Item>}
        {!query.startsWith('=') && query && !results.length && <Item data-disabled><small>{t('common.nothingFound')}</small></Item>}
      </Box>
    </Back>,
    document.body
  );
};
