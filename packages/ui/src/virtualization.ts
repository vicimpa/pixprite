import { defineElement, installStyle } from './base';

export type VirtualKey = string | number | bigint;
export type VirtualWindow = { indices: number[]; positions: number[]; total: number };
export type VirtualConfiguration = {
  keys: readonly VirtualKey[];
  estimate?: number;
  current?: number;
  measurementKey?: string;
  onWindow?: (window: VirtualWindow) => void;
};

/** Measured windowing, scroll anchoring and keyboard focus shared by all renderers. */
export class PxVirtualList extends HTMLElement {
  scrollElement: HTMLElement | null = null;
  renderItem: ((index: number) => Node) | null = null;
  private configuration: VirtualConfiguration = { keys: [] };
  private sizes = new Map<VirtualKey, number>();
  private events: AbortController | null = null;
  private viewport: ResizeObserver | null = null;
  private rows: ResizeObserver | null = null;
  private positions = [0];
  private focused: number | null = null;
  private pendingFocus: { index: number; backward: boolean } | null = null;
  private anchor: { index: number; offset: number; bottom: boolean } | null = null;
  private width = -1;
  private signature = '';
  private pendingWindow: VirtualWindow = { indices: [], positions: [0], total: 0 };
  private nativeContent: HTMLElement | null = null;
  private nativeKeys = new Map<HTMLElement, VirtualKey>();
  private renderQueued = false;
  private pendingScroll: number | null = null;

  connectedCallback() {
    installStyle(this.ownerDocument, 'pixprite-ui-virtual', 'px-virtual-list{display:contents}.px-virtual-scroll{overflow:auto;overflow-anchor:none}.px-virtual-content{position:relative;flex-shrink:0}.px-virtual-row{position:absolute;left:0;right:0;display:flow-root}');
    queueMicrotask(() => { if (this.isConnected) this.refresh(); });
  }
  disconnectedCallback() { this.stop(); }
  connectedMoveCallback() { }

  get state() { return this.pendingWindow; }

  configure(configuration: VirtualConfiguration) {
    const old = this.configuration;
    const keysChanged = old.keys.length !== configuration.keys.length || old.keys.some((key, index) => key !== configuration.keys[index]);
    const invalidated = old.estimate !== configuration.estimate || old.measurementKey !== configuration.measurementKey;
    if (invalidated) { this.remember(); this.sizes.clear(); }
    this.configuration = configuration;
    if (keysChanged) this.signature = '';
    if (!this.isConnected) return;
    this.refresh();
    if (configuration.current !== undefined && old.current !== configuration.current) this.reveal(configuration.current);
  }

  /** Reconcile after a renderer mounts the rows announced by windowchange. */
  refresh() {
    if (!this.isConnected) return;
    const scroll = this.querySelector<HTMLElement>('[data-virtual-scroll]') ?? this;
    if (this.scrollElement !== scroll || !this.events) {
      this.stop();
      this.scrollElement = scroll;
      if (scroll !== this) this.style.display = 'contents'; else this.style.display = 'block';
      scroll.classList.add('px-virtual-scroll');
      this.events = new AbortController();
      const signal = this.events.signal;
      scroll.addEventListener('scroll', () => this.update(), { passive: true, signal });
      scroll.addEventListener('focusin', event => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]');
        if (row) { this.focused = Number(row.dataset.virtualIndex); this.update(); }
      }, { signal });
      scroll.addEventListener('focusout', event => {
        if (!scroll.contains(event.relatedTarget as Node | null)) { this.focused = null; this.update(); }
      }, { signal });
      scroll.addEventListener('keydown', event => this.keydown(event), { signal });
      this.viewport = new ResizeObserver(() => {
        if (this.width !== scroll.clientWidth) { this.remember(); this.sizes.clear(); this.width = scroll.clientWidth; }
        this.update();
      });
      this.viewport.observe(scroll);
      this.width = scroll.clientWidth;
    }
    this.applyPendingScroll();
    this.update();
    this.observeRows();
    this.restoreFocus();
  }

  reveal(index: number) {
    const scroll = this.scrollElement;
    if (!scroll || index < 0 || index >= this.configuration.keys.length) return;
    if (this.positions[index] < scroll.scrollTop) scroll.scrollTop = this.positions[index];
    else if (this.positions[index + 1] > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = this.positions[index + 1] - scroll.clientHeight;
    this.update();
  }

  private remember() {
    const scroll = this.scrollElement;
    if (!scroll) return;
    let index = 0;
    while (index + 1 < this.positions.length && this.positions[index + 1] <= scroll.scrollTop) index++;
    this.anchor = { index, offset: scroll.scrollTop - this.positions[index], bottom: scroll.scrollTop + scroll.clientHeight >= this.positions[this.positions.length - 1] - 1 };
  }

  private update() {
    const scroll = this.scrollElement;
    if (!scroll) return;
    const { keys, estimate = 28 } = this.configuration;
    const positions = [0];
    keys.forEach((key, index) => positions.push(positions[index] + (this.sizes.get(key) ?? estimate)));
    this.positions = positions;
    if (this.anchor) {
      const anchor = this.anchor;
      const top = anchor.bottom ? positions[positions.length - 1] - scroll.clientHeight : positions[Math.min(anchor.index, keys.length)] + anchor.offset;
      // The renderer still has the old spacer height. Restore on its next refresh.
      this.anchor = null;
      this.pendingScroll = Math.max(0, top);
    }
    let start = 0;
    while (start < keys.length && positions[start + 1] < scroll.scrollTop) start++;
    start = Math.max(0, start - 2);
    let end = start;
    while (end < keys.length && positions[end] < scroll.scrollTop + scroll.clientHeight) end++;
    end = Math.min(keys.length, end + 2);
    const indices = Array.from({ length: end - start }, (_, index) => start + index);
    if (this.focused !== null && this.focused < keys.length && !indices.includes(this.focused)) indices.push(this.focused);
    indices.sort((a, b) => a - b);
    const signature = `${indices.join(',')}|${positions.join(',')}`;
    this.pendingWindow = { indices, positions, total: positions[positions.length - 1] };
    if (signature === this.signature) return;
    this.signature = signature;
    // Resize/scroll observers may fire outside React commits; one notification per microtask.
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (!this.isConnected) return;
      if (this.renderItem) this.renderNative();
      this.configuration.onWindow?.(this.pendingWindow);
      const EventClass = this.ownerDocument.defaultView!.CustomEvent;
      this.dispatchEvent(new EventClass('windowchange', { detail: this.pendingWindow }));
    });
  }

  private observeRows() {
    const scroll = this.scrollElement;
    if (!scroll) return;
    this.rows?.disconnect();
    this.rows = new ResizeObserver(entries => {
      let dirty = false;
      this.remember();
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.virtualIndex);
        const key = this.configuration.keys[index];
        if (key === undefined) continue;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && this.sizes.get(key) !== height) { this.sizes.set(key, height); dirty = true; }
      }
      if (dirty) this.update(); else this.anchor = null;
    });
    scroll.querySelectorAll<HTMLElement>('[data-virtual-index]').forEach(row => this.rows!.observe(row));
  }

  private stops(row: HTMLElement) {
    return [...row.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
  }

  private keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.matches('input,select,textarea') || target.isContentEditable) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]');
    if (!row) return;
    const index = Number(row.dataset.virtualIndex), stops = this.stops(row);
    const edge = event.key === 'Tab' && event.target === (event.shiftKey ? stops[0] : stops[stops.length - 1]);
    const next = edge ? index + (event.shiftKey ? -1 : 1) : event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? this.configuration.keys.length - 1 : -1;
    if (next < 0 || next >= this.configuration.keys.length) return;
    event.preventDefault();
    this.pendingFocus = { index: next, backward: edge && event.shiftKey };
    this.focused = next;
    this.reveal(next);
    this.restoreFocus();
  }

  private restoreFocus() {
    const pending = this.pendingFocus, scroll = this.scrollElement;
    if (!pending || !scroll) return;
    const row = scroll.querySelector<HTMLElement>(`[data-virtual-index="${pending.index}"]`);
    const stops = row && this.stops(row);
    const target = pending.backward ? stops?.[stops.length - 1] : stops?.[0];
    if (target) { this.pendingFocus = null; target.focus({ preventScroll: true }); }
  }

  private renderNative() {
    const scroll = this.scrollElement!, render = this.renderItem!;
    if (!this.nativeContent) { this.nativeContent = this.ownerDocument.createElement('div'); this.nativeContent.className = 'px-virtual-content'; scroll.append(this.nativeContent); }
    const content = this.nativeContent;
    content.style.height = `${this.pendingWindow.total}px`;
    const mounted = new Map([...content.children].map(el => [this.nativeKeys.get(el as HTMLElement), el as HTMLElement]));
    const visible = new Set(this.pendingWindow.indices.map(index => this.configuration.keys[index]));
    for (const [key, row] of mounted) if (key === undefined || !visible.has(key)) { row.remove(); this.nativeKeys.delete(row); }
    const focused = this.ownerDocument.activeElement as HTMLElement | null;
    const draftHost = focused?.closest('px-input');
    draftHost?.setAttribute('data-px-moving', '');
    for (const [order, index] of this.pendingWindow.indices.entries()) {
      const key = this.configuration.keys[index];
      let row = mounted.get(key);
      if (!row) { row = this.ownerDocument.createElement('div'); row.className = 'px-virtual-row'; row.append(render(index)); content.append(row); this.nativeKeys.set(row, key); }
      row.dataset.virtualIndex = String(index);
      row.style.top = `${this.pendingWindow.positions[index]}px`;
      if (content.children[order] !== row) {
        const before = content.children[order] ?? null;
        const atomic = content as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
        if (atomic.moveBefore && row.isConnected) atomic.moveBefore(row, before);
        else content.insertBefore(row, before);
      }
    }
    if (focused?.isConnected && this.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
    draftHost?.removeAttribute('data-px-moving');
    this.applyPendingScroll(); this.update(); this.observeRows(); this.restoreFocus();
  }

  private applyPendingScroll() {
    if (this.pendingScroll === null || !this.scrollElement) return;
    this.scrollElement.scrollTop = this.pendingScroll;
    this.pendingScroll = null;
  }

  private stop() {
    this.events?.abort(); this.events = null;
    this.viewport?.disconnect(); this.viewport = null;
    this.rows?.disconnect(); this.rows = null;
  }
}

export function registerVirtualList(registry: CustomElementRegistry = customElements) { defineElement('px-virtual-list', PxVirtualList, registry); }
