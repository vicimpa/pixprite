import { defineElement } from './base';
import { installCompositeStyles } from './composite-styles';

export type MenuEntry = { id?: string; label: string; shortcut?: string; checked?: boolean; disabled?: boolean; run?: () => void; items?: MenuItems };
export type MenuItems = (MenuEntry | '-' | null | false)[];
export type MenuIconProvider = (name: 'check' | 'submenu', document: Document) => HTMLElement;
export type MenuDefinition = { label: string; items: () => MenuItems };
type Level = { list: HTMLDivElement; rows: HTMLElement[]; parent?: Level; owner?: HTMLElement; submenu?: Level };
type Row = { entry: MenuEntry; level: Level };
let nextMenuId = 0;

/** Model, DOM, pointer and keyboard behavior shared with extension panels. */
export class PxMenuElement extends HTMLElement {
  private _items: MenuItems = [];
  private _x = 0;
  private _y = 0;
  private popup?: HTMLDivElement;
  private rootLevel?: Level;
  private current?: HTMLElement;
  private rows = new WeakMap<HTMLElement, Row>();
  private cleanup?: () => void;
  private focusReturn?: HTMLElement;
  flipX?: number;
  dismissOnOutside = true;
  iconProvider?: MenuIconProvider;
  invoker?: HTMLElement;
  get items() { return this._items; }
  set items(items: MenuItems) { this._items = items; this.render(); }
  get x() { return this._x; }
  set x(x: number) { this._x = x; this.render(); }
  get y() { return this._y; }
  set y(y: number) { this._y = y; this.render(); }
  connectedCallback() {
    this.cleanup?.(); installCompositeStyles(this.ownerDocument);
    const view = this.ownerDocument.defaultView!;
    const outside = (event: PointerEvent) => {
      if (this.popup && this.dismissOnOutside && !this.popup.contains(event.target as Node) && !this.contains(event.target as Node)) this.dismiss(false);
    };
    const blur = () => this.dismiss(false);
    const key = (event: KeyboardEvent) => this.onKey(event);
    view.addEventListener('pointerdown', outside); view.addEventListener('blur', blur); view.addEventListener('keydown', key, true);
    this.cleanup = () => { view.removeEventListener('pointerdown', outside); view.removeEventListener('blur', blur); view.removeEventListener('keydown', key, true); };
    this.render();
  }
  disconnectedCallback() {
    this.cleanup?.(); this.cleanup = undefined; this.popup?.remove(); this.popup = undefined; this.rootLevel = undefined; this.current = undefined;
  }
  dismiss(restoreFocus = true) {
    if (!this.popup) return;
    this.popup.remove(); this.popup = undefined; this.rootLevel = undefined; this.current = undefined;
    if (restoreFocus && this.focusReturn?.isConnected) this.focusReturn.focus({ preventScroll: true });
    this.dispatchEvent(new Event('px-dismiss', { bubbles: true }));
  }
  focusFirst(last = false) {
    const level = this.rootLevel;
    if (!level) return;
    const rows = this.enabled(level), item = last ? rows.at(-1) : rows[0];
    if (item) this.activate(level, item, true);
  }
  private render() {
    if (!this.isConnected) return;
    const active = this.ownerDocument.activeElement as HTMLElement | null;
    if (this.invoker) this.focusReturn = this.invoker;
    else if (active && !this.popup?.contains(active)) this.focusReturn = active;
    this.popup?.remove(); this.current = undefined;
    this.rootLevel = this.makeList(this.items); this.popup = this.rootLevel.list;
    this.popup.dataset.pxMenuRoot = '';
    this.ownerDocument.body.append(this.popup); this.position(this.popup, this.x, this.y, this.flipX);
  }
  private position(list: HTMLElement, x: number, y: number, flipX?: number) {
    const view = this.ownerDocument.defaultView!, rect = list.getBoundingClientRect();
    const nx = x + rect.width > view.innerWidth ? flipX !== undefined ? flipX - rect.width : view.innerWidth - rect.width : x;
    list.style.left = `${Math.max(0, nx)}px`; list.style.top = `${Math.max(0, Math.min(y, view.innerHeight - rect.height))}px`;
  }
  private enabled(level: Level) { return level.rows.filter(row => row.dataset.disabled !== 'true'); }
  private activate(level: Level, item: HTMLElement, focus: boolean) {
    for (const row of level.rows) { row.tabIndex = row === item ? 0 : -1; row.dataset.active = String(row === item); }
    this.current = item;
    if (focus) item.focus({ preventScroll: true });
  }
  private closeSubmenu(level: Level) {
    const submenu = level.submenu;
    if (!submenu) return;
    this.closeSubmenu(submenu); submenu.list.remove();
    submenu.owner?.setAttribute('aria-expanded', 'false');
    if (submenu.owner) submenu.owner.dataset.open = 'false';
    if (this.current && submenu.list.contains(this.current)) this.current = submenu.owner;
    level.submenu = undefined;
  }
  private openSubmenu(item: HTMLElement, focus: boolean) {
    const state = this.rows.get(item);
    if (!state?.entry.items || state.entry.disabled) return;
    const { level, entry } = state;
    if (level.submenu?.owner !== item) {
      this.closeSubmenu(level);
      const submenu = this.makeList(entry.items!, level, item); level.submenu = submenu;
      level.list.append(submenu.list);
      const rect = item.getBoundingClientRect(); this.position(submenu.list, rect.right - 2, rect.top - 3, rect.left + 2);
      item.setAttribute('aria-controls', submenu.list.id); item.setAttribute('aria-expanded', 'true'); item.dataset.open = 'true';
    }
    if (focus && level.submenu) {
      const first = this.enabled(level.submenu)[0]; if (first) this.activate(level.submenu, first, true);
    }
  }
  private invoke(item: HTMLElement) {
    const state = this.rows.get(item);
    if (!state || state.entry.disabled) return;
    if (state.entry.items) { this.openSubmenu(item, true); return; }
    this.dismiss(); state.entry.run?.();
  }
  private onKey(event: KeyboardEvent) {
    const root = this.rootLevel;
    if (!this.popup || !root || event.defaultPrevented) return;
    // Multiple menu consumers may exist; only the frontmost visible menu owns keys.
    if ([...this.ownerDocument.querySelectorAll('[data-px-menu-root]')].at(-1) !== this.popup) return;
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'];
    if (!keys.includes(event.key)) return;
    if (event.key === 'Tab') { this.dismiss(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const focused = (this.ownerDocument.activeElement as HTMLElement | null)?.closest<HTMLElement>('.px-menu-item');
    const item = focused && this.rows.has(focused) ? focused : this.current;
    const state = item ? this.rows.get(item) : undefined;
    let level = state?.level ?? root;
    if (event.key === 'Escape') {
      while (level.submenu) level = level.submenu;
      if (level.parent && level.owner) { this.closeSubmenu(level.parent); this.activate(level.parent, level.owner, true); }
      else this.dismiss();
    } else if (event.key === 'ArrowLeft') {
      if (level.parent && level.owner) { this.closeSubmenu(level.parent); this.activate(level.parent, level.owner, true); }
    } else if (event.key === 'ArrowRight') {
      if (item) this.openSubmenu(item, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (item) this.invoke(item); else this.focusFirst();
    } else {
      const available = this.enabled(level); if (!available.length) return;
      const index = item ? available.indexOf(item) : -1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % available.length : index < 0 ? available.length - 1 : (index + available.length - 1) % available.length;
      this.activate(level, available[next], true);
    }
  }
  private makeList(items: MenuItems, parent?: Level, owner?: HTMLElement): Level {
    const doc = this.ownerDocument, list = doc.createElement('div');
    list.className = 'px-menu-list'; list.id = `px-menu-${++nextMenuId}`; list.setAttribute('role', 'menu');
    if (owner) list.setAttribute('aria-labelledby', owner.id);
    list.addEventListener('pointerdown', event => event.stopPropagation());
    const level: Level = { list, rows: [], parent, owner };
    for (const entry of items.filter(Boolean) as (MenuEntry | '-')[]) {
      const item = doc.createElement('div');
      if (entry === '-') { item.className = 'px-menu-divider'; item.setAttribute('role', 'separator'); list.append(item); continue; }
      item.className = 'px-menu-item'; item.id = `${list.id}-item-${level.rows.length}`; item.tabIndex = -1;
      item.dataset.disabled = String(!!entry.disabled); item.setAttribute('aria-disabled', String(!!entry.disabled));
      item.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (entry.checked !== undefined) item.setAttribute('aria-checked', String(entry.checked));
      if (entry.items) { item.setAttribute('aria-haspopup', 'menu'); item.setAttribute('aria-expanded', 'false'); }
      this.rows.set(item, { entry, level }); level.rows.push(item);
      const mark = doc.createElement('span'); mark.className = 'px-menu-mark'; mark.setAttribute('aria-hidden', 'true');
      if (entry.checked) { const check = this.iconProvider?.('check', doc) ?? doc.createElement('span'); if (!this.iconProvider) { check.dataset.icon = 'check'; check.textContent = '✓'; } mark.append(check); }
      const text = doc.createElement('span'); text.className = 'px-menu-text'; text.textContent = entry.label;
      const shortcut = doc.createElement('span'); shortcut.className = 'px-menu-shortcut'; shortcut.textContent = entry.shortcut ?? ''; shortcut.setAttribute('aria-hidden', 'true');
      const arrow = doc.createElement('span'); arrow.className = 'px-menu-mark'; arrow.setAttribute('aria-hidden', 'true');
      if (entry.items) { if (this.iconProvider) arrow.append(this.iconProvider('submenu', doc)); else { arrow.textContent = '›'; arrow.dataset.icon = 'submenu'; } }
      item.append(mark, text, shortcut, arrow); list.append(item);
      item.addEventListener('pointerenter', () => {
        if (level.submenu?.owner !== item) this.closeSubmenu(level);
        if (entry.disabled) return;
        this.activate(level, item, false); if (entry.items) this.openSubmenu(item, false);
      });
      item.addEventListener('click', () => this.invoke(item));
    }
    const first = this.enabled(level)[0]; if (first) first.tabIndex = 0;
    return level;
  }
}

/** Adopts React's native titles or creates titles for plain HTML consumers. */
export class PxMenuBarElement extends HTMLElement {
  iconProvider?: MenuIconProvider;
  private _menus: MenuDefinition[] = [];
  private openIndex: number | null = null;
  private focusedIndex = 0;
  private popup?: PxMenuElement;
  private cleanup?: () => void;
  get menus() { return this._menus; }
  set menus(menus: MenuDefinition[]) { this._menus = menus; this.renderTitles(); }
  connectedCallback() {
    this.cleanup?.(); installCompositeStyles(this.ownerDocument);
    queueMicrotask(() => { if (this.isConnected) this.renderTitles(); });
    const titleFrom = (event: Event) => {
      const title = (event.target as Element).closest<HTMLElement>('[data-menu-index]');
      return title && this.contains(title) ? title : null;
    };
    const down = (event: PointerEvent) => {
      const item = titleFrom(event); if (!item) return;
      event.stopPropagation(); const index = Number(item.dataset.menuIndex); this.focusTitle(index);
      if (this.openIndex === index) this.close(); else this.show(index, item);
    };
    const over = (event: PointerEvent) => {
      const item = titleFrom(event); if (!item || this.openIndex === null) return;
      const index = Number(item.dataset.menuIndex); if (this.openIndex !== index) this.show(index, item);
    };
    const key = (event: KeyboardEvent) => {
      const item = titleFrom(event); if (!item) return;
      const index = Number(item.dataset.menuIndex), titles = this.titles();
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); this.show(index, item, true, event.key === 'ArrowUp');
      } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && titles.length) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? titles.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : titles.length - 1)) % titles.length;
        this.focusTitle(next); if (this.openIndex !== null) this.show(next, titles[next], true);
      } else if (event.key === 'Escape' && this.popup) { event.preventDefault(); event.stopPropagation(); this.close(true); }
    };
    this.addEventListener('pointerdown', down); this.addEventListener('pointerover', over); this.addEventListener('keydown', key);
    this.cleanup = () => { this.removeEventListener('pointerdown', down); this.removeEventListener('pointerover', over); this.removeEventListener('keydown', key); };
  }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; this.close(); }
  private titles() { return [...this.querySelectorAll<HTMLElement>('[data-menu-index]')]; }
  private renderTitles() {
    if (!this.isConnected) return;
    if (!this.titles().length && this.menus.length) {
      const bar = this.ownerDocument.createElement('div'); bar.className = 'px-menu-bar';
      this.menus.forEach((menu, index) => { const title = this.ownerDocument.createElement('div'); title.className = 'px-menu-title'; title.dataset.menuIndex = String(index); title.textContent = menu.label; bar.append(title); });
      this.prepend(bar);
    }
    this.querySelector('.px-menu-bar')?.setAttribute('role', 'menubar');
    for (const title of this.titles()) {
      title.setAttribute('role', 'menuitem'); title.setAttribute('aria-haspopup', 'menu'); title.setAttribute('aria-expanded', String(Number(title.dataset.menuIndex) === this.openIndex));
      title.tabIndex = Number(title.dataset.menuIndex) === this.focusedIndex ? 0 : -1;
    }
  }
  private focusTitle(index: number) {
    this.focusedIndex = index;
    this.titles().forEach((title, i) => { title.tabIndex = i === index ? 0 : -1; if (i === index) title.focus({ preventScroll: true }); });
  }
  private close(restoreFocus = false) {
    const index = this.openIndex; this.popup?.remove(); this.popup = undefined; this.openIndex = null;
    this.titles().forEach(el => { el.dataset.open = 'false'; el.setAttribute('aria-expanded', 'false'); });
    if (restoreFocus && index !== null) this.focusTitle(index);
  }
  private show(index: number, item: HTMLElement, focus = false, last = false) {
    this.close(); const menu = this.menus[index]; if (!menu) return;
    this.focusedIndex = index; this.titles().forEach((title, i) => title.tabIndex = i === index ? 0 : -1);
    this.openIndex = index; item.dataset.open = 'true'; item.setAttribute('aria-expanded', 'true');
    const rect = item.getBoundingClientRect(), popup = this.ownerDocument.createElement('px-menu') as PxMenuElement;
    popup.iconProvider = this.iconProvider; popup.invoker = item; popup.items = menu.items(); popup.x = rect.left; popup.y = rect.bottom;
    popup.addEventListener('px-dismiss', () => this.close()); this.popup = popup; this.append(popup);
    if (focus) popup.focusFirst(last);
  }
}

export function registerMenu(registry: CustomElementRegistry = customElements) {
  defineElement('px-menu', PxMenuElement, registry); defineElement('px-menu-bar', PxMenuBarElement, registry);
}
