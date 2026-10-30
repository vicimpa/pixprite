import { runCommand } from "~/core/Commands";
import { downloadProject, openFile } from "~/core/Files";
import { prettyCombo } from "~/core/Hotkeys";
import {
  createFolder, deleteFolder, deleteProject, duplicateProject, folderPath, folderSubtree, homeFolder, listFolders, listProjects, moveFolder, moveProject,
  getProjectMeta, renameProject, saveFolder, updateProjectInfo, setHomeFolder, type FolderMeta, type ProjectMeta,
} from "~/core/Projects";
import { state } from "~/core/State";
import { StoragePanel } from "./StoragePanel";
import { formatBytes } from "~/core/Storage";
import { openSnapshots, SnapshotList } from "./Snapshots";
import { checker, openPreview } from "./Preview";
import { keyNames, t } from "~/core/i18n";
import { dialogs } from "~/modules/Dialogs";
import { cmd } from "~/core/Commands";
import { Button, Muted, Select } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { LogoMark } from "~/ui/Logo";
import { editProjectInfo } from "~/modules/ProjectInfo";
import { askChoice, askConfirm, askText, Dialog, hasDialogs, openDialog } from "~/ui/Dialog";
import { openContextMenu, type MenuItems } from "~/ui/Menu";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import styled from "styled-components";
import { useViewport } from "~/ui/useViewport";
import { visibleRange } from "~/ui/virtualGeometry";

const Page = styled.div`
  position: absolute;
  inset: 0;
  overflow: auto;
  background: var(--workspace);
`;

const Inner = styled.div`
  max-width: 1100px;
  margin: 0 auto;
  padding: 28px 24px 40px;
  display: grid;
  grid-template-columns: minmax(240px, 300px) 1fr;
  gap: 28px;

  @media (max-width: 760px) { grid-template-columns: 1fr; }
`;

const Card = styled.section`
  padding: 14px 16px;
  background: var(--bg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Note = styled.p`
  margin: 0;
  color: var(--fg-dim);
  white-space: normal;
  line-height: 1.4;
`;

const Title = styled.h1`
  margin: 0;
  font-size: calc(var(--font-size) * 2);
  color: var(--accent);
  letter-spacing: .02em;
`;

const H = styled.h2`
  margin: 0 0 4px;
  font-size: calc(var(--font-size) * 1.15);
  font-weight: 600;
`;

const Sizes = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
`;

const Project = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* Grid items would otherwise grow to fit long names */
  min-width: 0;
  overflow: hidden;
  padding: 6px;
  background: var(--face);
  border: 1px solid var(--b1);
  cursor: pointer;

  &:hover { border-color: var(--accent); }
  &:hover > button { opacity: 1; }
  &[data-open=true] { box-shadow: inset 0 2px 0 var(--accent); }
  &:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  &[data-selected=true] { border-color: var(--accent); background: var(--face-hot); box-shadow: 0 0 0 1px var(--accent); }
  /* A dragged item hovering over this folder */
  &[data-drop=true] { border-color: var(--accent); background: var(--face-hot); }
`;

/** Folder path: Up, then one segment per level; segments take drops too */
const Crumbs = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;

  & > span { color: var(--fg-dim); padding: 0 2px; }
`;

const Crumb = styled.button`
  font: inherit;
  padding: 2px 5px;
  color: var(--fg);
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover { border-color: var(--b1); background: var(--face); }
  &:last-of-type { color: var(--accent); }
  &[data-drop=true] { border-color: var(--accent); background: var(--face-hot); }
`;

const Tree = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 280px;
  max-height: 340px;
  overflow-y: auto;
  border: 1px solid var(--b1);
  background: var(--field);
`;

const TreeRow = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  text-align: left;
  padding: 3px 6px;
  color: var(--fg);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) { background: var(--face-hot); }
  &[data-picked=true] { background: var(--accent); color: var(--bg); }
  &:disabled { color: var(--fg-dim); cursor: default; }
`;

const Thumb = styled.div`
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--workspace);
  border: 1px solid var(--b1);

  & > img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
`;

const Name = styled.div`
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  & > span { white-space: nowrap; }
`;

/** Rubber band drawn while selecting by dragging over empty space */
const Band = styled.div`
  position: fixed;
  z-index: 5;
  pointer-events: none;
  border: 1px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
`;

const Reveal = styled.button`
  align-self: flex-start;
  max-width: 100%;
  padding: 0;
  font: inherit;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover { text-decoration: underline; }
`;

const Download = styled.button`
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 6px;
  font: inherit;
  color: var(--fg);
  background: var(--face);
  border: 1px solid var(--b1);
  cursor: pointer;
  opacity: 0;
  transition: opacity .1s;

  &:hover { background: var(--face-hot); }
`;

const Keys = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  & > b { font-weight: normal; color: var(--accent); white-space: nowrap; }
`;

const Search = styled.input`
  font: inherit;
  padding: 4px 6px;
  color: var(--fg);
  background: var(--field);
  border: 1px solid var(--b1);
  min-width: 0;
  flex: 1 1 auto;
`;

function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('home.justNow');
  if (s < 3600) return t('home.nMinAgo').replace('{n}', String(Math.floor(s / 60)));
  if (s < 86400) return t('home.nHAgo').replace('{n}', String(Math.floor(s / 3600)));
  return new Date(ms).toLocaleDateString();
}


const SIZES: [number, number][] = [[16, 16], [32, 32], [64, 64], [128, 128], [256, 144], [320, 180]];

/** A home page item: what gets selected, dragged, renamed, moved or deleted */
type Item = { kind: 'folder' | 'project'; id: string; name: string; /** Containing folder */ parent: string | null; };

const keyOf = (i: { kind: Item['kind']; id: string; }) => `${i.kind[0]}:${i.id}`;

const DRAG_TYPE = 'application/x-pixprite-item';
/** The items being dragged; dataTransfer can't be read while hovering */
let dragging: Item[] | null = null;

type Sort = 'updated' | 'name';
const SORT_KEY = 'pixprite:homeSort';
const loadSort = (): Sort => { try { return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'updated'; } catch { return 'updated'; } };

const byName = (a: { name: string; }, b: { name: string; }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const sorted = <T extends { name: string; updated: number; }>(list: T[], sort: Sort) =>
  list.slice().sort(sort === 'name' ? byName : (a, b) => b.updated - a.updated);

/** An open tab keeps the document of a deleted project, now as unsaved work without a file */
function detachOpen(projectId: string) {
  const open = state.docs.find(d => d.projectId === projectId);
  if (open) { open.projectId = null; open.savedVersion = -1; open.storedVersion = -1; state.save(); }
}

/** Folders the items can't go into: every moved folder and everything inside it */
function bannedFor(items: Item[], folders: FolderMeta[]) {
  const out = new Set<string>();
  for (const i of items) if (i.kind === 'folder') for (const id of folderSubtree(folders, i.id)) out.add(id);
  return out;
}

async function moveItems(items: Item[], target: string | null) {
  let refused = false;
  for (const item of items) {
    if (item.parent === target) continue;
    if (item.kind === 'project') await moveProject(item.id, target);
    else if (item.id === target || !await moveFolder(item.id, target)) refused = true;
  }
  if (refused) state.showTip(t('home.aFolderCantBe'));
  state.projectsVersion++;
}

/** Asks where to move items: the folder tree, with the moved folders' own branches unavailable */
function pickFolder(items: Item[], folders: FolderMeta[], current: string | null) {
  return new Promise<string | null | undefined>(resolve => {
    const banned = bannedFor(items, folders);
    const rows: { f: FolderMeta | null; depth: number; }[] = [{ f: null, depth: 0 }];
    const add = (parent: string | null, depth: number) => {
      for (const f of folders.filter(f => f.parentId === parent).sort(byName)) { rows.push({ f, depth }); add(f.id, depth + 1); }
    };
    add(null, 1);
    const Picker: FC<{ close: () => void; }> = ({ close }) => {
      const [picked, setPicked] = useState<string | null>(current && !banned.has(current) ? current : null);
      let chosen = false;
      return (
        <Dialog title={items.length === 1 ? t('home.moveNameTo', { name: items[0].name }) : t('home.moveNItemsTo', { n: items.length })}
          submitLabel={t('home.move')}
          onSubmit={() => { chosen = true; resolve(picked); }}
          onClose={() => { close(); if (!chosen) resolve(undefined); }}>
          <Tree>
            {rows.map(({ f, depth }) => (
              <TreeRow key={f?.id ?? ''} type="button" style={{ paddingLeft: 6 + depth * 14 }}
                disabled={!!f && banned.has(f.id)} data-picked={picked === (f?.id ?? null)}
                onClick={() => setPicked(f?.id ?? null)}>
                <Icon name={f ? 'folder' : 'home'} scale="glyph" /> {f ? f.name : t('common.allProjects')}
              </TreeRow>
            ))}
          </Tree>
        </Dialog>
      );
    };
    openDialog(close => <Picker close={close} />);
  });
}

/**
 * What the pointer carries while dragging: the card itself, or for several items
 * a small stack of the first cards with the count. Built off screen, removed right after the browser copies it.
 */
function dragImage(e: React.DragEvent, cards: HTMLElement[], count: number) {
  const first = cards[0];
  if (!first) return;
  const w = first.offsetWidth;
  const ghost = document.createElement('div');
  Object.assign(ghost.style, { position: 'fixed', left: '-10000px', top: '0', width: `${w + 16}px`, height: `${first.offsetHeight + 16}px` });
  cards.slice(0, 3).reverse().forEach((card, i, all) => {
    const c = card.cloneNode(true) as HTMLElement;
    const shift = (all.length - 1 - i) * 6;
    Object.assign(c.style, { position: 'absolute', left: `${shift}px`, top: `${shift}px`, width: `${w}px`, boxShadow: '2px 2px 0 var(--shadow)' });
    ghost.append(c);
  });
  if (count > 1) {
    const badge = document.createElement('div');
    badge.textContent = String(count);
    Object.assign(badge.style, {
      position: 'absolute', right: '0', top: '0', minWidth: '18px', padding: '1px 5px', textAlign: 'center',
      font: 'inherit', color: 'var(--bg)', background: 'var(--accent)', border: '1px solid var(--b1)',
    });
    ghost.append(badge);
  }
  // Inside the page root, so the theme's variables and fonts apply
  first.parentElement!.append(ghost);
  const r = first.getBoundingClientRect();
  e.dataTransfer.setDragImage(ghost, Math.min(w, e.clientX - r.left), Math.min(first.offsetHeight, e.clientY - r.top));
  setTimeout(() => ghost.remove());
}

export const Home: FC = () => {
  useSignals();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(loadSort);
  /** Selected items by key ('f:id' / 'p:id'), and where a Shift range starts */
  const pendingFocus = useRef<{ key: string; backward: boolean } | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  /** Drop target under dragged items: folder id, '' for the root */
  const [hot, setHot] = useState<string | undefined>(undefined);
  /** Rubber band in window coordinates */
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number; } | null>(null);
  /** An item to scroll to once its folder is shown */
  const [reveal, setReveal] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const viewport = useViewport(page, grid);
  const gridSize = useViewport(grid);
  /** A single click on a project waits a moment: a double click opens it instead of the preview */
  const clickTimer = useRef(0);
  void state.prefs.language;

  useEffect(() => {
    let alive = true;
    listProjects().then(p => { if (alive) setProjects(p); }).catch(() => setProjects([]));
    listFolders().then(f => { if (alive) setFolders(f); }).catch(() => setFolders([]));
    return () => { alive = false; };
  }, [state.projectsVersion]);

  useEffect(() => () => clearTimeout(clickTimer.current), []);

  const create = (w: number, h: number) => {
    const doc = state.newDocument();
    doc.reset(w, h, 'untitled');
    state.fit();
    state.save();
  };

  // A remembered folder that no longer exists means the root
  const loaded = projects !== null;
  const folder = folders.find(f => f.id === homeFolder.value) ? homeFolder.value : null;
  useEffect(() => { if (loaded && homeFolder.value && !folder) setHomeFolder(null); }, [loaded, folder]);
  const path = folderPath(folders, folder);
  const select = (keys: Iterable<string>) => setSelected(new Set(keys));
  const go = (id: string | null) => { setQuery(''); setHomeFolder(id); select([]); anchor.current = null; };
  const up = () => { if (folder) go(path.at(-2)?.id ?? null); };

  // Searching gives one flat list from every folder; otherwise the open folder's own folders, then its projects
  const q = query.trim().toLowerCase();
  const shownFolders = sorted(q ? folders.filter(f => f.name.toLowerCase().includes(q)) : folders.filter(f => f.parentId === folder), sort);
  const shown = sorted((projects ?? []).filter(p => q ? p.name.toLowerCase().includes(q) : (p.folderId ?? null) === folder), sort);
  const items: Item[] = [
    ...shownFolders.map(f => ({ kind: 'folder' as const, id: f.id, name: f.name, parent: f.parentId })),
    ...shown.map(p => ({ kind: 'project' as const, id: p.id, name: p.name, parent: p.folderId ?? null })),
  ];
  const columns = Math.max(1, Math.floor((gridSize.width + 10) / 160));
  const cardWidth = Math.max(0, (gridSize.width - (columns - 1) * 10) / columns);
  const rowHeight = cardWidth + (q ? 12 + 3 * state.ui.font * 1.2 : 8 + 2 * state.ui.font * 1.2);
  const virtualRows = visibleRange(Math.ceil(items.length / columns), rowHeight + 10, viewport.top, viewport.height);
  const first = virtualRows.start * columns, last = Math.min(items.length, virtualRows.end * columns);
  const mounted = new Set(Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i));
  if (focusedKey) { const i = items.findIndex(item => keyOf(item) === focusedKey); if (i >= 0) mounted.add(i); }
  const revealIndex = (i: number) => {
    const el = page.current;
    if (!el || i < 0) return;
    const y = Math.floor(i / columns) * (rowHeight + 10);
    const top = el.scrollTop - viewport.top;
    if (y < viewport.top) el.scrollTop = top + y;
    else if (y + rowHeight > viewport.top + viewport.height) el.scrollTop = top + y + rowHeight - viewport.height;
  };
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const card = grid.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(pending.key)}"]`);
    const stops = card?.querySelectorAll<HTMLElement>('button, [tabindex]');
    const target = pending.backward && stops?.length ? stops[stops.length - 1] : card;
    if (target) { pendingFocus.current = null; target.focus({ preventScroll: true }); }
  });
  const picked = items.filter(i => selected.has(keyOf(i)));
  const where = (id: string | null | undefined) => '/ ' + folderPath(folders, id).map(f => f.name).join(' / ');
  const count = (id: string) => folders.filter(f => f.parentId === id).length + (projects ?? []).filter(p => p.folderId === id).length;

  // Once the folder of a revealed item is on screen, bring the item into view
  useEffect(() => {
    if (!reveal) return;
    revealIndex(items.findIndex(i => keyOf(i) === reveal));
    const el = grid.current?.querySelector(`[data-key="${CSS.escape(reveal)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setReveal(null);
  });

  /** "Go to folder" on a search result: its folder, with the item selected */
  const goTo = (item: Item) => {
    go(item.parent);
    select([keyOf(item)]);
    anchor.current = keyOf(item);
    setReveal(keyOf(item));
  };

  const newFolder = async () => {
    const name = await askText(t('home.folderName'), t('home.newFolder'), { title: t('home.newFolder'), ok: t('common.create') });
    if (!name) return;
    const f = await createFolder(name, folder);
    select([keyOf({ kind: 'folder', id: f.id })]);
    state.projectsVersion++;
  };

  const rename = async (item: Item) => {
    const name = await askText(t('home.newName'), item.name, { title: t('home.rename'), ok: t('common.rename') });
    if (!name) return;
    if (item.kind === 'project') {
      await renameProject(item.id, name);
      const open = state.docs.find(d => d.projectId === item.id);
      if (open) open.name = name;
    } else {
      const f = folders.find(f => f.id === item.id);
      if (f) await saveFolder({ ...f, name, updated: Date.now() });
    }
    state.projectsVersion++;
  };

  const duplicate = async (item: Item) => {
    const id = await duplicateProject(item.id, t('home.copyOfName', { name: item.name }));
    if (id) select([keyOf({ kind: 'project', id })]);
    state.projectsVersion++;
  };

  /** Deletes items after asking; non-empty folders ask what happens to their contents */
  const remove = async (list: Item[]) => {
    if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    const full = list.filter(i => i.kind === 'folder' && count(i.id));
    let mode: 'lift' | 'all' = 'lift';
    if (full.length) {
      const answer = await askChoice(one ? t('home.theFolderNameIs', { name: one.name }) : t('home.someFoldersNotEmpty', { n: list.length }),
        [t('home.moveContentsUpA'), t('home.deleteEverythingInside')], { title: t('home.deleteFolder') });
      if (answer < 0) return;
      if (answer === 1) {
        mode = 'all';
        const ok = await askConfirm(one ? t('home.allProjectsInsideName', { name: one.name }) : t('home.allProjectsInsideSelection'),
          { title: t('home.deleteFolder'), ok: t('common.delete') });
        if (!ok) return;
      }
    } else {
      const message = !one ? t('home.deleteNItemsForGood', { n: list.length })
        : one.kind === 'project' ? t('home.deleteNameForGood', { name: one.name }) : t('home.deleteTheEmptyFolder', { name: one.name });
      if (!await askConfirm(message, { title: t('home.delete'), ok: t('common.delete') })) return;
    }
    for (const item of list) {
      if (item.kind === 'project') { detachOpen(item.id); await deleteProject(item.id); }
      else (await deleteFolder(item.id, mode)).forEach(detachOpen);
    }
    select([]);
    state.projectsVersion++;
  };

  const moveTo = async (list: Item[]) => {
    if (!list.length) return;
    const from = list.every(i => i.parent === list[0].parent) ? list[0].parent : folder;
    const target = await pickFolder(list, folders, from);
    if (target !== undefined) await moveItems(list, target);
  };

  /** What an action on a card applies to: the whole selection when the card is part of it */
  const targetsOf = (item: Item) => selected.has(keyOf(item)) ? picked : [item];

  const preview = (p: ProjectMeta) => {
    const item: Item = { kind: 'project', id: p.id, name: p.name, parent: p.folderId ?? null };
    openPreview(p, where(p.folderId), {
      open: () => void state.openProject(p.id),
      rename: () => void rename(item),
      moveTo: () => void moveTo([item]),
      duplicate: () => void duplicate(item),
      remove: () => void remove([item]),
      editInfo: () => editProjectInfo(p.name, p.info ?? {}, async info => {
        await updateProjectInfo(p.id, info);
        // An open tab of the project shows the same info (its own unsaved changes stay unsaved)
        const open = state.docs.find(d => d.projectId === p.id);
        if (open) open.info = info;
        state.projectsVersion++;
        const fresh = await getProjectMeta(p.id);
        if (fresh) preview(fresh);
      }),
    });
  };

  /** Plain click: select and act; Ctrl / Cmd toggles; Shift extends from the last clicked item */
  const click = (e: React.MouseEvent, item: Item, act: () => void) => {
    const key = keyOf(item);
    if (e.shiftKey && anchor.current) {
      const keys = items.map(keyOf);
      const a = keys.indexOf(anchor.current), b = keys.indexOf(key);
      if (a >= 0) {
        const range = keys.slice(Math.min(a, b), Math.max(a, b) + 1);
        return select(e.ctrlKey || e.metaKey ? [...selected, ...range] : range);
      }
    }
    anchor.current = key;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      next.has(key) ? next.delete(key) : next.add(key);
      return setSelected(next);
    }
    select([key]);
    act();
  };

  // Keys of the browser: only on the home page, with no dialog open and nothing typed into
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!state.home || hasDialogs() || state.commandPalette || e.altKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyA') { e.preventDefault(); select(items.map(keyOf)); }
      else if (mod) return;
      else if (e.key === 'Escape' && selected.size) { e.preventDefault(); select([]); }
      else if (e.key === 'Backspace') { e.preventDefault(); up(); }
      else if (e.key === 'Delete' && picked.length) { e.preventDefault(); void remove(picked); }
      else if (e.key === 'F2' && picked.length === 1) { e.preventDefault(); void rename(picked[0]); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // Rubber band: dragging over empty space selects the cards it touches (Ctrl / Shift add to the selection)
  const startBand = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-key], button, input, a, [role=listbox]')) return;
    // No text selection while the band is drawn
    e.preventDefault();
    const base = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selected) : new Set<string>();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const r = { left: Math.min(x0, ev.clientX), right: Math.max(x0, ev.clientX), top: Math.min(y0, ev.clientY), bottom: Math.max(y0, ev.clientY) };
      setBand({ x0, y0, x1: ev.clientX, y1: ev.clientY });
      const next = new Set(base);
      const bounds = grid.current?.getBoundingClientRect();
      if (bounds) items.forEach((item, i) => {
        const left = bounds.left + (i % columns) * (cardWidth + 10), top = bounds.top + Math.floor(i / columns) * (rowHeight + 10);
        if (left < r.right && left + cardWidth > r.left && top < r.bottom && top + rowHeight > r.top) next.add(keyOf(item));
      });
      setSelected(next);
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      setBand(null);
      // A click on empty space clears the selection
      if (!moved && !base.size) select([]);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
  };

  /** Takes dragged items: folder cards and path segments */
  const dropTarget = (target: string | null) => {
    const key = target ?? '';
    const takes = () => !!dragging && !(target && bannedFor(dragging, folders).has(target)) && !dragging.every(i => i.parent === target);
    return {
      'data-drop': hot === key,
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE) || !takes()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (hot !== key) setHot(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (hot === key && !e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(undefined);
      },
      onDrop: (e: React.DragEvent) => {
        const list = dragging;
        setHot(undefined);
        if (!list || !e.dataTransfer.types.includes(DRAG_TYPE) || !takes()) return;
        e.preventDefault();
        dragging = null;
        void moveItems(list, target);
      },
    };
  };

  /** Shared by folder and project cards: selection look, dragging, the key for the rubber band */
  const cardProps = (item: Item) => ({
    tabIndex: 0,
    style: { gridColumn: items.findIndex(i => keyOf(i) === keyOf(item)) % columns + 1,
      gridRow: Math.floor(items.findIndex(i => keyOf(i) === keyOf(item)) / columns) + 1 },
    draggable: true,
    'data-key': keyOf(item),
    'data-selected': selected.has(keyOf(item)),
    onDragStart: (e: React.DragEvent) => {
      // Dragging an unselected card moves just that card (and selects it)
      const list = targetsOf(item);
      if (!selected.has(keyOf(item))) select([keyOf(item)]);
      dragging = list;
      e.dataTransfer.setData(DRAG_TYPE, list.map(keyOf).join(' '));
      e.dataTransfer.effectAllowed = 'move';
      const cards = list.map(i => grid.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(i))}"]`)).filter(Boolean) as HTMLElement[];
      // The grabbed card goes on top of the stack
      dragImage(e, [e.currentTarget as HTMLElement, ...cards.filter(c => c !== e.currentTarget)], list.length);
    },
    onDragEnd: () => { dragging = null; setHot(undefined); },
  });

  const contextMenu = (e: React.MouseEvent, item: Item, own: MenuItems) => {
    e.preventDefault();
    // Right click on an unselected card works on that card alone
    if (!selected.has(keyOf(item))) { select([keyOf(item)]); anchor.current = keyOf(item); }
    const list = targetsOf(item);
    if (list.length > 1) {
      return openContextMenu([
        { label: t('home.nSelected', { n: list.length }), disabled: true },
        { label: t('home.moveTo'), run: () => void moveTo(list) },
        '-',
        { label: t('home.delete'), run: () => void remove(list) },
      ], e.clientX, e.clientY);
    }
    openContextMenu([
      ...own,
      { label: t('home.rename'), run: () => void rename(item) },
      { label: t('home.moveTo'), run: () => void moveTo([item]) },
      !!q && { label: t('home.goToFolder'), run: () => goTo(item) },
      '-',
      { label: t('home.delete'), run: () => void remove([item]) },
    ], e.clientX, e.clientY);
  };

  const totalFrames = (projects ?? []).reduce((n, p) => n + p.frames, 0);
  const shortcut = (id: string) => prettyCombo(cmd(id).keys?.[0]);

  return (
    <Page ref={page}>
      <Inner>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <LogoMark size={64} />
              <Title>Pixprite</Title>
            </div>
            <Note>{t('home.pixelArtAndAnimation')}</Note>
          </Card>
          <Card>
            <H>{t('common.newSprite')}</H>
            <Sizes>
              {SIZES.map(([w, h]) => <Button key={`${w}x${h}`} onClick={() => create(w, h)}>{w}×{h}</Button>)}
            </Sizes>
            <Button $primary onClick={() => dialogs.newSprite()}><Icon name="plus" scale="glyph" /> {t('home.customSize')}</Button>
          </Card>
          <Card>
            <H>{t('home.open')}</H>
            <Button onClick={() => openFile()}>{t('home.openFile')} <Muted>{shortcut('file.open')}</Muted></Button>
            <Button onClick={() => dialogs.importSheet()}>{t('home.importSpriteSheet')}</Button>
            <Note>{t('home.orDropImagesGifs')}</Note>
          </Card>
          <Card>
            <H>{t('home.recentSnapshots')}</H>
            <SnapshotList limit={5} />
          </Card>
          <Card>
            <H>{t('home.summary')}</H>
            <Muted>{t('home.nProjects').replace('{n}', String(projects?.length ?? 0))} · {t('dialog.importSheet.nFrames').replace('{n}', String(totalFrames))}</Muted>
            <Muted>{t('home.nOpenTabs').replace('{n}', String(state.docs.length))}</Muted>
          </Card>
          <Card><StoragePanel projects={projects} /></Card>
          <Card>
            <H>{t('home.handyKeys')}</H>
            <Keys>
              <b>{shortcut('view.commandPalette')}</b><span>{t('home.runAnyCommandBy')}</span>
              <b>{t('home.spaceKey')}</b><span>{t('home.holdToPanThe')}</span>
              <b>{keyNames('Alt')}</b><span>{t('home.holdToPickA')}</span>
              <b>{keyNames('Ctrl')} + {t('home.wheel')}</b><span>{t('home.zoom')}</span>
              <b>{shortcut('edit.undo')}</b><span>{t('home.undo')}</span>
              <b>F1</b><span>{t('home.allKeyboardShortcuts')}</span>
            </Keys>
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, minHeight: 300 }} onPointerDown={startBand}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <H style={{ margin: 0 }}>{t('home.projects')}</H>
            <Search placeholder={t('home.searchInAllFolders')} value={query} onChange={e => { setQuery(e.target.value); select([]); }} onKeyDown={e => e.stopPropagation()} />
            <Select value={sort} title={t('home.sort')} onChange={e => {
              const v = e.target.value as Sort;
              setSort(v);
              try { localStorage.setItem(SORT_KEY, v); } catch { /* storage blocked */ }
            }}>
              <option value="updated">{t('home.lastModified')}</option>
              <option value="name">{t('common.name')}</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button disabled={!folder} title={`${t('home.up')} (Backspace)`} onClick={up}><Icon name="up" scale="glyph" /></Button>
            <Crumbs style={{ flex: '1 1 auto' }}>
              <Crumb {...dropTarget(null)} onClick={() => go(null)} title={t('common.allProjects')}><Icon name="home" scale="glyph" /></Crumb>
              {path.map(f => [
                <span key={`/${f.id}`}>/</span>,
                <Crumb key={f.id} {...dropTarget(f.id)} onClick={() => go(f.id)}>{f.name}</Crumb>,
              ])}
            </Crumbs>
            {picked.length > 1 && <Muted>{t('home.nSelected', { n: picked.length })}</Muted>}
            <Button onClick={() => void newFolder()}><Icon name="plus" scale="glyph" /> {t('home.newFolder')}</Button>
          </div>
          {state.uncleanExit && (
            <Card style={{ borderColor: 'var(--accent)' }}>
              <Note>{t('home.lastSessionNotClosed')}</Note>
              <div><Button onClick={() => { state.uncleanExit = false; }}>{t('home.dismiss')}</Button></div>
            </Card>
          )}
          {q && <Muted>{t('home.resultsFromAllFolders')}</Muted>}
          {!loaded && <Muted>{t('home.loading')}</Muted>}
          {loaded && !projects.length && !folders.length && <Card><Note>{t('home.noProjectsYet')}</Note></Card>}
          {loaded && !q && !items.length && (projects.length || folders.length) ? <Muted>{t('home.thisFolderIsEmpty')}</Muted> : null}
          {q && !items.length && <Muted>{t('common.nothingFound')}</Muted>}
          <Grid ref={grid} style={{ height: Math.max(0, Math.ceil(items.length / columns) * (rowHeight + 10) - 10),
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(items.length / columns)}, ${rowHeight}px)` }}
            onFocusCapture={e => setFocusedKey((e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key ?? null)}
            onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedKey(null); }}
            onKeyDown={e => {
              const card = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
              const stops = card ? [card, ...card.querySelectorAll<HTMLElement>('button, [tabindex]')] : [];
              const tabEdge = e.key === 'Tab' && e.target === (e.shiftKey ? stops[0] : stops.at(-1));
              const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
              const i = items.findIndex(item => keyOf(item) === key);
              const next = tabEdge ? i + (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' ? i + columns : e.key === 'ArrowUp' ? i - columns : e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
              if (i < 0 || next < 0 || next >= items.length) return;
              e.preventDefault();
              pendingFocus.current = { key: keyOf(items[next]), backward: tabEdge && e.shiftKey };
              setFocusedKey(keyOf(items[next])); revealIndex(next);
            }}>
            {shownFolders.filter((_, i) => mounted.has(i)).map(f => {
              const item: Item = { kind: 'folder', id: f.id, name: f.name, parent: f.parentId };
              return (
                <Project
                  key={f.id}
                  {...cardProps(item)}
                  {...dropTarget(f.id)}
                  title={f.name}
                  onClick={e => click(e, item, () => go(f.id))}
                  onKeyDown={e => { if (e.key === 'Enter') go(f.id); }}
                  onContextMenu={e => contextMenu(e, item, [{ label: t('home.open'), run: () => go(f.id) }])}
                >
                  <Thumb><Icon name="folder" scale={8} /></Thumb>
                  <Name>{f.name}</Name>
                  <Name><Muted>{t('home.nItems', { n: count(f.id) })}</Muted></Name>
                  {q && <Reveal type="button" title={t('home.goToFolder')} onClick={e => { e.stopPropagation(); goTo(item); }}>{where(f.parentId)}</Reveal>}
                </Project>
              );
            })}
            {shown.filter((_, i) => mounted.has(i + shownFolders.length)).map(p => {
              const item: Item = { kind: 'project', id: p.id, name: p.name, parent: p.folderId ?? null };
              return (
                <Project
                  key={p.id}
                  {...cardProps(item)}
                  onKeyDown={e => { if (e.key === 'Enter') void state.openProject(p.id); }}
                  data-open={state.docs.some(d => d.projectId === p.id)}
                  title={`${p.name} · ${p.width}×${p.height} · ${p.frames} ${t('common.framesLower')}`}
                  onClick={e => click(e, item, () => {
                    clearTimeout(clickTimer.current);
                    if (e.detail < 2) clickTimer.current = window.setTimeout(() => preview(p), 250);
                  })}
                  onDoubleClick={e => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                    clearTimeout(clickTimer.current);
                    void state.openProject(p.id);
                  }}
                  onContextMenu={e => contextMenu(e, item, [
                    { label: t('home.open'), run: () => void state.openProject(p.id) },
                    { label: t('common.preview'), run: () => preview(p) },
                    { label: t('home.snapshots'), run: () => openSnapshots(p.id, p.name) },
                    { label: t('recovery.previous'), run: () => void state.recoverProject(p.id) },
                    { label: t('home.downloadPixprite'), run: () => void downloadProject(p.id, 'pixprite') },
                    { label: t('home.downloadAseprite'), run: () => void downloadProject(p.id, 'aseprite') },
                    { label: t('common.duplicate'), run: () => void duplicate(item) },
                  ])}
                >
                  <Thumb>{p.thumb && <img src={p.thumb} alt="" draggable={false} style={{
                    ...checker(p.width, p.height),
                    // Fills the card along the longer side, keeping the sprite's proportions
                    aspectRatio: `${p.width} / ${p.height}`,
                    ...(p.width >= p.height ? { width: '100%' } : { height: '100%' }),
                  }} />}</Thumb>
                  <Download title={t('home.downloadPixprite')} onClick={e => { e.stopPropagation(); void downloadProject(p.id); }}><Icon name="download" scale="glyph" /></Download>
                  <Name>{p.name}</Name>
                  <Name><Muted>{p.width}×{p.height} · {p.frames} {t('home.fr')} · {ago(p.updated)}{p.bytes !== undefined ? ` · ${formatBytes(p.bytes)}` : ''}</Muted></Name>
                  {q && <Reveal type="button" title={t('home.goToFolder')} onClick={e => { e.stopPropagation(); goTo(item); }}>{where(p.folderId)}</Reveal>}
                </Project>
              );
            })}
          </Grid>
          <div><Button onClick={() => runCommand('help.shortcuts')}>{t('common.keyboardShortcutsMenu')}</Button></div>
        </div>
      </Inner>
      {band && <Band style={{
        left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1),
        width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0),
      }} />}
    </Page>
  );
};
