import { available, COMMANDS } from "~/core/Commands";
import { t } from "~/core/i18n";
import { loadFiles, blobToBitmap } from "~/core/Files";
import { state } from "~/core/State";
import { SELECT_TOOLS, TOOLS, active } from "~/core/Tools";
import { hasDialogs } from "~/ui/Dialog";

/** Modifier keys currently held, so the canvas can re-evaluate shapes without a mouse move */
export const held = { space: false, shift: false, ctrl: false, alt: false };
const listeners = new Set<() => void>();
export function onModifiers(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function trackModifiers(e: KeyboardEvent, down: boolean) {
  const before = JSON.stringify(held);
  if (e.code === 'Space') held.space = down;
  held.shift = e.shiftKey;
  held.ctrl = e.ctrlKey || e.metaKey;
  held.alt = e.altKey;
  if (JSON.stringify(held) !== before) listeners.forEach(fn => fn());
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  ' ': 'Space', Esc: 'Escape', Del: 'Delete',
};

/** Normalized combo like "Ctrl+Shift+Z" (Cmd counts as Ctrl) */
export function comboOf(e: KeyboardEvent) {
  let key = KEY_NAMES[e.key] ?? e.key;
  // Use physical keys for letters and digits so Shift / layouts don't change them
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  const mods = [
    (e.ctrlKey || e.metaKey) && 'Ctrl',
    e.altKey && 'Alt',
    e.shiftKey && key.length > 1 && 'Shift',
    e.shiftKey && /^[A-Z0-9]$/.test(key) && 'Shift',
  ].filter(Boolean);
  return [...mods, key].join('+');
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Key names follow the chosen style (Mac symbols or Windows / Linux words) */
export function macKeys() {
  const style = state.prefs.keyStyle;
  return style === 'mac' || (style !== 'pc' && isMac);
}

export function prettyCombo(combo?: string) {
  if (!combo) return '';
  return macKeys()
    ? combo.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧')
    : combo;
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return (el?.tagName === 'INPUT' && !['checkbox', 'range', 'radio'].includes((el as HTMLInputElement).type))
    || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT';
}

/** Keep native checkbox/radio/slider keys out of document navigation and quick tools. */
function controlOwnsKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = e.target as HTMLInputElement | null;
  if (el?.tagName !== 'INPUT' || !['checkbox', 'range', 'radio'].includes(el.type)) return false;
  if (e.key === ' ' || e.key === 'Enter') return true;
  if (el.type === 'range') return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key);
  return el.type === 'radio' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
}

const lastByKey = new Map<string, string>();

/** A tool key picks the last used tool sharing that key; Shift+key cycles through them */
function selectTool(key: string, cycle: boolean) {
  const group = TOOLS.filter(t => t.key === key);
  if (!group.length) return false;
  const i = group.findIndex(t => t.name === state.tool);
  const remembered = group.find(t => t.name === lastByKey.get(key)) ?? group[0];
  const next = cycle
    ? group[i >= 0 ? (i + 1) % group.length : Math.min(1, group.length - 1)]
    : i >= 0 ? group[i] : remembered;
  state.tool = next.name;
  lastByKey.set(key, next.name);
  return true;
}

function onKeyDown(e: KeyboardEvent) {
  if (isTyping(e) || controlOwnsKey(e) || hasDialogs() || state.commandPalette) return;
  trackModifiers(e, true);
  const combo = comboOf(e);

  if (active.session) {
    if (e.key === 'Escape') { active.session.cancel?.(); active.session = null; return e.preventDefault(); }
    if (e.key === 'Enter') { active.session.finish?.(); active.session = null; state.save(); return e.preventDefault(); }
    // Mid-stroke, modifiers belong to the tool (Space moves shapes) and only zoom keys work
    if (['Space', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return e.preventDefault();
    if (!/^(Ctrl\+)?[=+-]$/.test(combo)) return e.preventDefault();
  }

  // Quick tools while a key is held: Space → hand, Alt → eyedropper, Ctrl → move
  if (e.code === 'Space' && !e.repeat) {
    state.quickTool = 'hand';
    return e.preventDefault();
  }
  if (e.key === 'Alt') {
    if (!SELECT_TOOLS.includes(state.tool)) state.quickTool = 'picker';
    return e.preventDefault();
  }
  if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat && !SELECT_TOOLS.includes(state.tool) && state.tool !== 'move') {
    state.quickTool = 'move';
    return;
  }
  if (e.key === 'Shift' && state.quickTool === 'move') state.quickTool = null;

  for (const c of COMMANDS) {
    if (!c.keys?.includes(combo)) continue;
    if (!available(c)) continue;
    e.preventDefault();
    if (state.quickTool === 'move') state.quickTool = null;
    c.run();
    return;
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey && /^Key[A-Z]$/.test(e.code)) {
    if (selectTool(e.code.slice(3).toLowerCase(), e.shiftKey)) e.preventDefault();
  }
}

function onKeyUp(e: KeyboardEvent) {
  trackModifiers(e, false);
  if (e.code === 'Space' && state.quickTool === 'hand') state.quickTool = null;
  if (e.key === 'Alt' && state.quickTool === 'picker') state.quickTool = null;
  if ((e.key === 'Control' || e.key === 'Meta') && state.quickTool === 'move') state.quickTool = null;
}

async function onPaste(e: ClipboardEvent) {
  if (isTyping(e as unknown as KeyboardEvent)) return;
  e.preventDefault();
  const file = [...e.clipboardData?.files ?? []].find(f => f.type.startsWith('image/'));
  if (!file && state.clipKind === 'range' && state.rangeClipboard) {
    state.clipSource = null;
    state.sprite.pasteRange(state.rangeClipboard);
    state.save();
    return;
  }
  const bmp = file ? await blobToBitmap(file) : state.clipboard;
  if (!bmp) return;
  state.sprite.paste(bmp, state.pastePosition(bmp));
  state.tool = 'move';
  state.save();
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const files = [...e.dataTransfer?.files ?? []];
  if (files.length) return void loadFiles(files);
  // Some apps (code editors, for one) hand over only paths, which a web page can't read
  const uris = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
  if (/file:\/\//.test(uris) || /\.(aseprite|ase|pixprite|png|gif|gpl)\b/i.test(uris))
    state.showTip(t('msg.onlyPathsArrivedNot'), 5000);
}

let installed: AbortController | null = null;

// Drags that start inside the page (project cards, timeline) are never files, even when
// a thumbnail makes the browser add a uri-list
let internalDrag = false;

/** A drag carrying files from outside the page (or paths from apps that only pass paths) */
export const isFileDrag = (e: DragEvent) =>
  !internalDrag && [...e.dataTransfer?.types ?? []].some(t => t === 'Files' || t === 'text/uri-list');

export function installHotkeys() {
  // Replace listeners from a previous module instance (hot reload)
  installed?.abort();
  const ctrl = installed = new AbortController();
  addEventListener('keydown', onKeyDown, ctrl);
  addEventListener('keyup', onKeyUp, ctrl);
  addEventListener('paste', onPaste, ctrl);
  // Capture phase: no element on the way can swallow a file drag
  const capture = { signal: ctrl.signal, capture: true };
  addEventListener('dragstart', () => { internalDrag = true; }, capture);
  addEventListener('dragend', () => { internalDrag = false; }, capture);
  const allowDrop = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  addEventListener('dragenter', allowDrop, capture);
  addEventListener('dragover', allowDrop, capture);
  addEventListener('drop', e => {
    if (!isFileDrag(e)) return;
    onDrop(e);
  }, capture);
  addEventListener('blur', () => {
    state.quickTool = null;
    Object.assign(held, { space: false, shift: false, ctrl: false, alt: false });
  }, ctrl);
}

import.meta.hot?.dispose(() => installed?.abort());
