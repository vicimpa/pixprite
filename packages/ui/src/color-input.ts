import { defineElement, emit } from './base';
import { installCompositeStyles } from './composite-styles';
import { trackPointer } from './pointer';

function parse(hex: string): [number, number, number] {
  let raw = hex.replace(/^#/, ''); if (raw.length === 3) raw = raw.split('').map(c => c + c).join('');
  if (!/^[\da-f]{6}$/i.test(raw)) return [0, 0, 0];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16) / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), delta = hi - lo;
  const h = !delta ? 0 : hi === r ? ((g - b) / delta + 6) % 6 : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [h * 60, hi ? delta / hi : 0, hi];
}
function hex(h: number, s: number, v: number) {
  const c = v * s, n = (h / 60) % 6, x = c * (1 - Math.abs(n % 2 - 1)), m = v - c;
  const rgb = n < 1 ? [c, x, 0] : n < 2 ? [x, c, 0] : n < 3 ? [0, c, x] : n < 4 ? [0, x, c] : n < 5 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(c => Math.round((c + m) * 255).toString(16).padStart(2, '0')).join('');
}

export class PxColorInputElement extends HTMLElement {
  static observedAttributes = ['value', 'disabled', 'title'];
  private control?: HTMLInputElement;
  private button?: HTMLButtonElement;
  private swatch?: HTMLSpanElement;
  private popup?: HTMLDivElement;
  private field?: HTMLDivElement;
  private marker?: HTMLDivElement;
  private hueMarker?: HTMLDivElement;
  private hexInput?: HTMLInputElement;
  private paletteNode?: HTMLDivElement;
  private cleanup?: () => void;
  private connection = 0;
  private closeCleanup?: () => void;
  private cancelDrag?: () => void;
  private _value = '#000000';
  private _palette: string[] = [];
  private hsv: [number, number, number] = [0, 0, 0];
  get value() { return this.control?.value ?? this._value; }
  set value(value: string) {
    this._value = value; this.hsv = parse(value);
    if (this.control) this.control.value = value;
    if (this.swatch) this.swatch.style.background = value;
    if (this.hexInput && this.ownerDocument.activeElement !== this.hexInput) this.hexInput.value = value;
    this.updateMarkers();
  }
  get palette() { return this._palette; }
  set palette(value: string[]) { this._palette = value; this.renderPalette(); }
  get disabled() { return this.hasAttribute('disabled') || !!this.control?.disabled; }
  set disabled(value: boolean) { this.toggleAttribute('disabled', value); if (this.control) this.control.disabled = value; if (this.button) this.button.disabled = value; }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'value' && value !== null) this.value = value;
    else if (name === 'disabled') {
      if (this.control) this.control.disabled = value !== null;
      if (this.button) this.button.disabled = value !== null;
    } else if (name === 'title' && this.button) this.button.title = value ?? '';
  }
  connectedCallback() {
    installCompositeStyles(this.ownerDocument);
    const connection = ++this.connection;
    queueMicrotask(() => { if (this.isConnected && this.connection === connection) this.initialize(); });
  }
  private initialize() {
    this.cleanup?.();
    this.control = this.querySelector('input[type=color]') ?? this.ownerDocument.createElement('input');
    this.control.type = 'color'; this.control.style.display = 'none';
    if (!this.control.parentElement) { this.control.value = this.getAttribute('value') ?? this._value; this.append(this.control); }
    this.button = this.querySelector('button') ?? this.ownerDocument.createElement('button');
    this.button.type = 'button'; this.button.className = 'px-color-swatch'; this.button.title = this.title;
    this.button.setAttribute('aria-label', this.getAttribute('aria-label') ?? (this.title || 'Color'));
    this.button.setAttribute('aria-haspopup', 'dialog'); this.button.setAttribute('aria-expanded', 'false'); this.button.disabled = this.disabled;
    this.swatch = this.ownerDocument.createElement('span'); this.button.replaceChildren(this.swatch); this.append(this.button);
    this.value = this.control.value;
    const click = () => { if (this.popup) this.close(); else this.show(); };
    const change = () => { this.value = this.control!.value; };
    this.button.addEventListener('click', click); this.control.addEventListener('change', change);
    this.cleanup = () => { this.button?.removeEventListener('click', click); this.control?.removeEventListener('change', change); };
  }
  disconnectedCallback() { ++this.connection; this.cleanup?.(); this.cleanup = undefined; this.close(); }
  private show() {
    if (this.disabled || !this.button) return;
    const doc = this.ownerDocument, view = doc.defaultView!, popup = doc.createElement('div'); this.popup = popup;
    popup.className = 'px-color-popup'; popup.setAttribute('role', 'dialog');
    this.field = doc.createElement('div'); this.field.className = 'px-color-field';
    this.marker = doc.createElement('div'); this.marker.className = 'px-color-marker'; this.field.append(this.marker);
    const strip = doc.createElement('div'); strip.className = 'px-color-strip';
    this.hueMarker = doc.createElement('div'); this.hueMarker.className = 'px-color-marker'; this.hueMarker.style.top = '50%'; strip.append(this.hueMarker);
    this.paletteNode = doc.createElement('div'); this.paletteNode.className = 'px-color-palette';
    this.hexInput = doc.createElement('input'); this.hexInput.className = 'px-color-hex'; this.hexInput.value = this.value; this.hexInput.spellcheck = false; this.hexInput.setAttribute('aria-label', 'Hex color');
    this.hexInput.addEventListener('input', () => {
      const match = /^#?([\da-f]{6}|[\da-f]{3})$/i.exec(this.hexInput!.value.trim());
      if (match) { this.hsv = parse('#' + match[1]); this.apply(false); }
    });
    const drag = (element: HTMLElement, change: (x: number, y: number) => void) => element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const update = (e: PointerEvent) => {
        const rect = element.getBoundingClientRect();
        change(Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1))), Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1))));
        this.apply();
      };
      this.cancelDrag?.(); update(event);
      this.cancelDrag = trackPointer(event, element, (_x, _y, e) => update(e), () => { this.cancelDrag = undefined; });
    });
    drag(this.field, (x, y) => { this.hsv[1] = x; this.hsv[2] = 1 - y; });
    drag(strip, x => { this.hsv[0] = x * 360; });
    popup.append(this.field, strip, this.paletteNode, this.hexInput); doc.body.append(popup);
    this.renderPalette(); this.updateMarkers();
    const position = () => {
      const rect = this.button!.getBoundingClientRect(), box = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(4, Math.min(rect.left, view.innerWidth - box.width - 4))}px`;
      popup.style.top = `${Math.max(4, view.innerHeight - rect.bottom > box.height ? rect.bottom + 2 : rect.top - box.height - 2)}px`;
      popup.style.maxHeight = `${Math.max(0, view.innerHeight - 8)}px`; popup.style.overflowY = 'auto';
    };
    position();
    const outside = (event: PointerEvent) => { if (!popup.contains(event.target as Node) && !this.contains(event.target as Node)) this.close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.close(); this.button?.focus({ preventScroll: true });
    };
    popup.addEventListener('keydown', event => event.stopPropagation());
    view.addEventListener('pointerdown', outside, true); view.addEventListener('keydown', key, true); view.addEventListener('resize', position);
    this.closeCleanup = () => { view.removeEventListener('pointerdown', outside, true); view.removeEventListener('keydown', key, true); view.removeEventListener('resize', position); };
    this.button.setAttribute('aria-expanded', 'true');
  }
  private renderPalette() {
    if (!this.paletteNode) return;
    this.paletteNode.replaceChildren();
    for (const color of this.palette) {
      const button = this.ownerDocument.createElement('button'); button.type = 'button'; button.title = color; button.style.background = color;
      button.addEventListener('click', () => { this.hsv = parse(color); this.apply(); }); this.paletteNode.append(button);
    }
  }
  private apply(updateText = true) {
    const value = hex(...this.hsv); this._value = value;
    if (this.control) this.control.value = value;
    if (this.swatch) this.swatch.style.background = value;
    if (updateText && this.hexInput) this.hexInput.value = value;
    this.updateMarkers();
    if (this.control) { emit(this.control, 'input'); emit(this.control, 'change'); }
  }
  private updateMarkers() {
    const [h, s, v] = this.hsv;
    if (this.field) this.field.style.background = `linear-gradient(transparent,#000),linear-gradient(90deg,#fff,hsl(${h},100%,50%))`;
    if (this.marker) { this.marker.style.left = `${s * 100}%`; this.marker.style.top = `${(1 - v) * 100}%`; }
    if (this.hueMarker) this.hueMarker.style.left = `${h / 360 * 100}%`;
  }
  private close() { this.cancelDrag?.(); this.cancelDrag = undefined; this.closeCleanup?.(); this.closeCleanup = undefined; this.popup?.remove(); this.popup = undefined; this.field = undefined; this.hexInput = undefined; this.paletteNode = undefined; this.button?.setAttribute('aria-expanded', 'false'); }
}

export function registerColorInput(registry: CustomElementRegistry = customElements) { defineElement('px-color-input', PxColorInputElement, registry); }
