import { defineElement, emit } from './base';
import { installCompositeStyles } from './composite-styles';
import { trackPointer } from './pointer';

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

export type SliderPosition = { x: number; y: number; alt: boolean; drag: boolean };
export class PxSliderElement extends HTMLElement {
  static observedAttributes = ['x', 'y', 'freeze-x', 'freeze-y', 'flip-x', 'flip-y', 'line'];
  private point?: HTMLElement;
  private cleanup?: () => void;
  private observer?: ResizeObserver;
  private cancelDrag?: () => void;
  private _x = .5;
  private _y = .5;
  drag = false;
  alt = false;
  get freezeX() { return this.hasAttribute('freeze-x'); }
  set freezeX(value: boolean) { this.toggleAttribute('freeze-x', value); }
  get freezeY() { return this.hasAttribute('freeze-y'); }
  set freezeY(value: boolean) { this.toggleAttribute('freeze-y', value); }
  get flipX() { return this.hasAttribute('flip-x'); }
  set flipX(value: boolean) { this.toggleAttribute('flip-x', value); }
  get flipY() { return this.hasAttribute('flip-y'); }
  set flipY(value: boolean) { this.toggleAttribute('flip-y', value); }
  get line() { return this.hasAttribute('line'); }
  set line(value: boolean) { this.toggleAttribute('line', value); }
  get x() { return this._x; }
  set x(n: number) { this._x = clamp(n); this.updatePoint(); }
  get y() { return this._y; }
  set y(n: number) { this._y = clamp(n); this.updatePoint(); }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'x' && value !== null) this.x = Number(value);
    else if (name === 'y' && value !== null) this.y = Number(value);
    else this.updatePoint();
  }
  connectedCallback() {
    installCompositeStyles(this.ownerDocument); this.classList.add('px-xy-slider');
    this.point = this.querySelector('.px-slider-point') ?? this.ownerDocument.createElement('div');
    this.point.className = 'px-slider-point'; this.append(this.point);
    const down = (event: PointerEvent) => {
      if (event.button === 1) return;
      this.cancelDrag?.();
      this.drag = true; this.alt = event.button === 2;
      const update = (e: PointerEvent) => {
        const rect = this.getBoundingClientRect();
        const x = clamp((e.clientX - rect.left) / (rect.width || 1)), y = clamp((e.clientY - rect.top) / (rect.height || 1));
        if (!this.freezeX) this.x = this.flipX ? 1 - x : x;
        if (!this.freezeY) this.y = this.flipY ? 1 - y : y;
        this.notify();
      };
      update(event);
      this.cancelDrag = trackPointer(event, this, (_dx, _dy, e) => update(e), () => { this.cancelDrag = undefined; this.drag = false; this.alt = false; this.notify(); });
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const k = ((event.deltaY || event.deltaX) > 0 ? -1 : 1) * (event.shiftKey ? .1 : .01);
      const alongX = this.freezeY || (!this.freezeX && event.altKey);
      if (alongX) this.x += k; else this.y += k;
      this.notify();
    };
    const context = (event: Event) => event.preventDefault();
    this.addEventListener('pointerdown', down); this.addEventListener('wheel', wheel, { passive: false }); this.addEventListener('contextmenu', context);
    this.cleanup = () => { this.removeEventListener('pointerdown', down); this.removeEventListener('wheel', wheel); this.removeEventListener('contextmenu', context); };
    this.observer = new ResizeObserver(() => this.updatePoint()); this.observer.observe(this);
    this.updatePoint();
  }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; this.observer?.disconnect(); this.cancelDrag?.(); this.cancelDrag = undefined; }
  updatePoint() {
    if (!this.point) return;
    this.point.style.width = this.freezeX && this.line ? '100%' : '8px';
    this.point.style.height = this.freezeY && this.line ? '100%' : '8px';
    this.point.style.setProperty('--px-x', `${this.freezeX ? 0 : (this.x - .5) * this.clientWidth * (this.flipX ? -1 : 1)}px`);
    this.point.style.setProperty('--px-y', `${this.freezeY ? 0 : (this.y - .5) * this.clientHeight * (this.flipY ? -1 : 1)}px`);
  }
  private notify() { this.dispatchEvent(new CustomEvent<SliderPosition>('px-slider-change', { bubbles: true, detail: { x: this.x, y: this.y, alt: this.alt, drag: this.drag } })); }
}

export class PxSplitterElement extends HTMLElement {
  static observedAttributes = ['value', 'min', 'max', 'growth', 'vertical'];
  value = 0;
  min = 60;
  max = 800;
  growth: 1 | -1 = 1;
  private cleanup?: () => void;
  private cancelDrag?: () => void;
  get vertical() { return this.dataset.splitter !== 'rows'; }
  set vertical(value: boolean) { this.dataset.splitter = value ? 'columns' : 'rows'; }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'vertical') this.vertical = value !== null;
    else if (name === 'growth') this.growth = value === '-1' ? -1 : 1;
    else if (value !== null) this[name as 'value' | 'min' | 'max'] = Number(value);
  }
  connectedCallback() {
    installCompositeStyles(this.ownerDocument); this.classList.add('px-splitter');
    if (!this.dataset.splitter) this.vertical = true;
    this.setAttribute('role', 'separator'); this.tabIndex = 0;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const panel = (this.growth === 1 ? this.previousElementSibling : this.nextElementSibling) as HTMLElement | null;
      if (!panel) return;
      this.cancelDrag?.();
      const value = this.value, property = this.vertical ? 'width' : 'height'; let latest = value;
      this.dataset.drag = 'true';
      this.cancelDrag = trackPointer(event, this, (dx, dy) => {
        const next = clamp(Math.round(value + (this.vertical ? dx : dy) * this.growth), this.min, this.max);
        if (next === latest) return;
        latest = next; panel.style[property] = `${next}px`;
      }, () => { this.cancelDrag = undefined; this.dataset.drag = 'false'; if (latest !== value) { this.value = latest; emit(this, 'change'); } });
    };
    const key = (event: KeyboardEvent) => {
      const delta = this.vertical ? ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key] : ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const next = clamp(this.value + delta * this.growth * (event.shiftKey ? 10 : 1), this.min, this.max);
      if (next !== this.value) { this.value = next; emit(this, 'change'); }
    };
    this.addEventListener('pointerdown', down); this.addEventListener('keydown', key);
    this.cleanup = () => { this.removeEventListener('pointerdown', down); this.removeEventListener('keydown', key); };
  }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; this.cancelDrag?.(); this.cancelDrag = undefined; }
}

export class PxResizerElement extends HTMLElement {
  static observedAttributes = ['start'];
  private refresh?: () => void;
  get start() { return this.hasAttribute('start'); }
  set start(value: boolean) { this.toggleAttribute('start', value); }
  attributeChangedCallback() { this.refresh?.(); }
  private cleanup?: () => void;
  private observer?: ResizeObserver;
  private cancelDrag?: () => void;
  connectedCallback() {
    installCompositeStyles(this.ownerDocument);
    const handle = this.querySelector<HTMLElement>('.px-resizer') ?? this.ownerDocument.createElement('div');
    handle.className = 'px-resizer'; this.append(handle);
    const update = () => {
      const item = this.parentElement, parent = item?.parentElement;
      if (!parent) return;
      const direction = this.ownerDocument.defaultView!.getComputedStyle(parent).flexDirection;
      const column = direction.includes('column'), reverse = direction.includes('reverse');
      handle.dataset.column = String(column);
      handle.style.inset = '';
      const side = column ? (this.start !== reverse ? 'top' : 'bottom') : (this.start !== reverse ? 'left' : 'right');
      handle.style.setProperty(side, 'var(--p-size)');
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const item = this.parentElement, parent = item?.parentElement;
      if (!item || !parent) return;
      this.cancelDrag?.();
      const direction = this.ownerDocument.defaultView!.getComputedStyle(parent).flexDirection;
      const column = direction.includes('column'), reversed = this.start !== direction.includes('reverse');
      const basis = column ? item.offsetHeight : item.offsetWidth, maximum = column ? parent.offsetHeight : parent.offsetWidth;
      handle.dataset.drag = 'true';
      this.cancelDrag = trackPointer(event, handle, (dx, dy) => { item.style.flexBasis = `${clamp(basis - (column ? dy : dx) * (reversed ? -1 : 1), 0, maximum)}px`; }, () => { this.cancelDrag = undefined; handle.dataset.drag = 'false'; emit(this, 'change'); });
    };
    this.refresh = update; update(); this.observer = new ResizeObserver(update); if (this.parentElement?.parentElement) this.observer.observe(this.parentElement.parentElement);
    handle.addEventListener('pointerdown', down); this.cleanup = () => handle.removeEventListener('pointerdown', down);
  }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; this.observer?.disconnect(); this.cancelDrag?.(); this.cancelDrag = undefined; }
}

export function registerDragControls(registry: CustomElementRegistry = customElements) {
  defineElement('px-slider', PxSliderElement, registry); defineElement('px-splitter', PxSplitterElement, registry); defineElement('px-resizer', PxResizerElement, registry);
}
