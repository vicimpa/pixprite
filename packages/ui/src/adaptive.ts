import { defineElement, emit, focusable, installStyle, upgradeProperties } from './base';

const css = `
px-adaptive-bar {display:contents}
px-adaptive-bar>[data-adaptive-bar] {display:flex;align-items:center;gap:6px;min-width:0;width:100%;height:100%;overflow:hidden}
.px-adaptive-lane {display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden}
.px-adaptive-palette {display:flex;align-items:center;flex-wrap:wrap;gap:10px;max-width:100%}
.px-adaptive-palette>div {flex-wrap:wrap;max-width:100%;row-gap:8px!important}
.px-adaptive-palette label {max-width:100%}
.px-adaptive-palette span[title] {white-space:normal;overflow-wrap:anywhere}
.px-floating-panel {position:fixed;z-index:1000;width:max-content;max-width:min(680px,calc(100vw - 16px));padding:8px;background:var(--menu);color:var(--fg);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite),3px 3px 0 var(--shadow);box-sizing:border-box}
`;

function install(doc: Document) { installStyle(doc, 'pixprite-ui-adaptive', css); }

export class PxFloatingPanel extends HTMLElement {
  private _anchor: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private events: AbortController | null = null;
  private observer: ResizeObserver | null = null;
  private wasOpen = false;
  static observedAttributes = ['open', 'side', 'label', 'anchor'];

  connectedCallback() {
    install(this.ownerDocument);
    queueMicrotask(() => {
      if (!this.isConnected) return;
      upgradeProperties(this, ['anchor', 'open', 'side', 'label']);
      this.refresh();
    });
  }
  disconnectedCallback() { this.stop(); this.wasOpen = false; }
  connectedMoveCallback() { }
  attributeChangedCallback() { if (this.isConnected) this.refresh(); }
  get anchor() { return this._anchor ?? this.ownerDocument.getElementById(this.getAttribute('anchor') ?? ''); }
  set anchor(value: HTMLElement | null) { this._anchor = value; if (this.isConnected) this.refresh(); }
  get open() { return this.hasAttribute('open'); }
  set open(value: boolean) { this.toggleAttribute('open', !!value); }
  get side() { return this.hasAttribute('side'); }
  set side(value: boolean) { this.toggleAttribute('side', !!value); }
  get label() { return this.getAttribute('label') ?? ''; }
  set label(value: string) { this.setAttribute('label', value); }

  refresh() {
    install(this.ownerDocument);
    this.panel = this.querySelector<HTMLElement>('[data-floating-panel]') ?? this;
    const panel = this.panel;
    if (panel !== this) this.style.display = 'contents';
    panel.classList.add('px-floating-panel');
    panel.dataset.floatingPanel = '';
    panel.dataset.open = String(this.open);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', this.label);
    panel.style.display = this.open ? '' : 'none';
    this.stop();
    if (!this.open || !this.isConnected) { this.wasOpen = false; return; }
    this.position();
    const observer = this.observer = new ResizeObserver(() => this.position());
    observer.observe(panel);
    if (this.anchor?.parentElement) observer.observe(this.anchor.parentElement);
    this.events = new AbortController();
    const signal = this.events.signal, doc = this.ownerDocument;
    doc.defaultView!.addEventListener('resize', () => this.position(), { signal });
    doc.addEventListener('pointerdown', event => {
      const target = event.target as HTMLElement;
      if (!this.anchor?.contains(target) && !panel.contains(target) && !target.closest('[data-floating-panel], [data-select-popup], .px-color-popup')) this.dismiss();
    }, { capture: true, signal });
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || doc.querySelector('[data-select-popup], .px-color-popup, .px-menu-list')) return;
      const panels = doc.querySelectorAll('[data-floating-panel][data-open=true]');
      if (panels[panels.length - 1] !== panel) return;
      if ((event.target as HTMLElement).matches('input:not([type=checkbox]):not([type=range]),textarea')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.dismiss(); this.anchor?.focus({ preventScroll: true });
    }, { capture: true, signal });
    panel.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).closest('button')) event.stopPropagation();
    }, { signal });
    if (!this.wasOpen) focusable(panel)?.focus({ preventScroll: true });
    this.wasOpen = true;
  }

  position() {
    const anchor = this.anchor, panel = this.panel;
    if (!anchor || !panel || !this.open) return;
    const r = anchor.getBoundingClientRect(), view = this.ownerDocument.defaultView!;
    const x = this.side ? (r.left > view.innerWidth / 2 ? r.left - panel.offsetWidth - 4 : r.right + 4) : r.left;
    const y = this.side ? r.top : (view.innerHeight - r.bottom >= panel.offsetHeight + 8 ? r.bottom + 4 : r.top - panel.offsetHeight - 4);
    panel.style.left = `${Math.max(8, Math.min(x, view.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(y, view.innerHeight - panel.offsetHeight - 8))}px`;
  }
  private dismiss() { this.open = false; emit(this, 'dismiss'); }
  private stop() { this.events?.abort(); this.events = null; this.observer?.disconnect(); this.observer = null; }
}

export type AdaptiveItem = { key: string; host: HTMLElement; priority: number };
export type AdaptiveConfiguration = {
  lane: HTMLElement; palette: HTMLElement; button: HTMLButtonElement; items: AdaptiveItem[];
  onOverflow?: (overflow: boolean) => void;
};

/** Owns intrinsic measurement and DOM moves, independent of the renderer. */
export class PxAdaptiveBar extends HTMLElement {
  private configuration: AdaptiveConfiguration | null = null;
  private observer: ResizeObserver | null = null;
  private events: AbortController | null = null;
  private items = new Map<string, HTMLElement>();
  private overflow: boolean | null = null;
  private layingOut = false;
  private standalone: PxFloatingPanel | null = null;
  private scheduled = 0;

  connectedCallback() {
    install(this.ownerDocument);
    queueMicrotask(() => { if (this.isConnected) { if (!this.configuration) this.build(); this.observe(); this.layout(); } });
  }
  disconnectedCallback() {
    this.observer?.disconnect(); this.observer = null; this.events?.abort(); this.events = null;
    if (this.scheduled) this.ownerDocument.defaultView!.cancelAnimationFrame(this.scheduled);
    this.scheduled = 0;
  }
  connectedMoveCallback() { }

  configure(configuration: AdaptiveConfiguration) {
    for (const [key, host] of this.items) if (!configuration.items.some(item => item.key === key)) { this.observer?.unobserve(host); host.remove(); }
    this.configuration = configuration;
    this.items = new Map(configuration.items.map(item => [item.key, item.host]));
    if (this.isConnected) { this.observe(); this.layout(); }
  }

  private build() {
    const doc = this.ownerDocument, children = [...this.children] as HTMLElement[];
    const root = doc.createElement('div'); root.dataset.adaptiveBar = this.getAttribute('label') ?? '';
    const lane = doc.createElement('div'); lane.className = 'px-adaptive-lane';
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = '⋯'; button.setAttribute('aria-label', this.getAttribute('label') ?? 'More'); button.setAttribute('aria-haspopup', 'dialog');
    const floating = doc.createElement('px-floating-panel') as PxFloatingPanel;
    floating.label = this.getAttribute('label') ?? 'More'; floating.anchor = button;
    const palette = doc.createElement('div'); palette.className = 'px-adaptive-palette'; floating.append(palette);
    const items = children.map((host, index) => {
      const wrapper = doc.createElement('div'); wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0'; wrapper.append(host);
      return { key: String(index), host: wrapper, priority: Number(host.dataset.priority) || 0 };
    });
    root.append(lane, button, floating); this.append(root); this.standalone = floating;
    button.addEventListener('click', () => { floating.open = !floating.open; button.setAttribute('aria-expanded', String(floating.open)); });
    floating.addEventListener('dismiss', () => button.setAttribute('aria-expanded', 'false'));
    this.configure({ lane, palette, button, items });
  }

  private observe() {
    const config = this.configuration;
    if (!config) return;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(config.lane);
    for (const item of config.items) if (item.host.isConnected) this.observer.observe(item.host);
    if (!this.events) {
      this.events = new AbortController();
      this.ownerDocument.fonts.addEventListener('loadingdone', () => this.layout(), { signal: this.events.signal });
      // A viewport change must reconcile More before callers can interact with
      // it; defer only intrinsic ResizeObserver feedback to the next frame.
      this.ownerDocument.defaultView!.addEventListener('resize', () => this.layout(), { signal: this.events.signal });
    }
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = this.ownerDocument.defaultView!.requestAnimationFrame(() => { this.scheduled = 0; this.layout(); });
  }

  layout() {
    const config = this.configuration;
    if (!config || this.layingOut || !this.isConnected) return;
    this.layingOut = true;
    try {
      const { lane, palette, button, items } = config, doc = this.ownerDocument;
      const panel = palette.parentElement!;
      const display = panel.style.display;
      const focused = doc.activeElement as HTMLElement | null;
      const draftHost = focused?.closest('px-input');
      draftHost?.setAttribute('data-px-moving', '');
      panel.style.visibility = 'hidden'; panel.style.display = 'block';
      for (const item of items) {
        Object.assign(item.host.style, { display: 'flex', width: 'max-content', maxWidth: 'none', flexWrap: 'nowrap' });
        if (!item.host.isConnected) { lane.append(item.host); this.observer?.observe(item.host); }
      }
      const widths = new Map(items.map(item => [item, item.host.getBoundingClientRect().width]));
      const available = lane.clientWidth + (button.hidden ? 0 : button.offsetWidth + 6);
      const total = items.reduce((sum, item) => sum + (widths.get(item)! ? widths.get(item)! + 6 : 0), -6);
      const overflow = total > available;
      button.hidden = !overflow;
      let remaining = available - (overflow ? button.offsetWidth + 6 : 0);
      const fits = new Set<AdaptiveItem>();
      for (const item of [...items].sort((a, b) => b.priority - a.priority)) {
        const width = widths.get(item)!;
        if (width <= remaining) { fits.add(item); remaining -= width ? width + 6 : 0; }
      }
      for (const item of items) {
        item.host.style.maxWidth = '';
        if (!fits.has(item)) { item.host.style.width = ''; item.host.style.flexWrap = 'wrap'; }
        item.host.style.position = widths.get(item) ? '' : 'absolute';
      }
      for (const target of [lane, palette]) {
        const ordered = items.filter(item => (fits.has(item) ? lane : palette) === target);
        ordered.forEach((item, index) => {
          if (target.children[index] === item.host) return;
          const before = target.children[index] ?? null;
          const atomic = target as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
          if (atomic.moveBefore && item.host.isConnected) atomic.moveBefore(item.host, before);
          else {
            const keepDraft = (event: FocusEvent) => { if (event.target === focused) event.stopImmediatePropagation(); };
            doc.addEventListener('focusout', keepDraft, true);
            target.insertBefore(item.host, before);
            doc.removeEventListener('focusout', keepDraft, true);
          }
        });
      }
      panel.style.display = display; panel.style.visibility = '';
      if (focused?.isConnected && doc.activeElement !== focused) {
        // Reparenting can drop focus without an atomic moveBefore implementation.
        // Restoring the same focus must not restart a consumer's editing session.
        const keepEditing = (event: FocusEvent) => { if (event.target === focused) event.stopImmediatePropagation(); };
        doc.addEventListener('focus', keepEditing, true);
        doc.addEventListener('focusin', keepEditing, true);
        try { focused.focus({ preventScroll: true }); }
        finally {
          doc.removeEventListener('focus', keepEditing, true);
          doc.removeEventListener('focusin', keepEditing, true);
        }
      }
      draftHost?.removeAttribute('data-px-moving');
      if (this.overflow !== overflow) {
        this.overflow = overflow;
        config.onOverflow?.(overflow);
        const EventClass = doc.defaultView!.CustomEvent;
        this.dispatchEvent(new EventClass('overflowchange', { detail: { overflow }, bubbles: true }));
      }
      if (!overflow && this.standalone) this.standalone.open = false;
    } finally { this.layingOut = false; }
  }
}

export function registerAdaptive(registry: CustomElementRegistry = customElements) {
  defineElement('px-floating-panel', PxFloatingPanel, registry);
  defineElement('px-adaptive-bar', PxAdaptiveBar, registry);
}
