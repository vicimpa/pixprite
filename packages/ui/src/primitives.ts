import { defineElement, emit, installStyles, upgradeProperties } from './base';

type NativeControl = HTMLInputElement | HTMLButtonElement | HTMLLabelElement | HTMLSpanElement;
const accessibilityAttributes = ['id', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby'];
let nextLabelId = 0;

/** Native children retain browser semantics, labels, forms and existing refs. */
abstract class NativeElement<T extends NativeControl> extends HTMLElement {
  control: T | null = null;
  protected abstract nativeTag: string;
  protected abstract nativeClass: string;
  protected controller: AbortController | null = null;
  private generatedLabel = false;
  private forwardedAccessibility = new Set<string>();
  static observedAttributes = accessibilityAttributes;
  attributeChangedCallback(_name: string) { this.syncAccessibility(); }

  connectedCallback() {
    installStyles(this.ownerDocument);
    queueMicrotask(() => {
      if (!this.isConnected) return;
      this.ensureControl();
      this.controller?.abort();
      this.controller = new AbortController();
      this.bind(this.controller.signal);
      upgradeProperties(this, ['value', 'disabled', 'checked', 'name']);
    });
  }

  disconnectedCallback() {
    this.controller?.abort();
    this.controller = null;
  }

  connectedMoveCallback() { }

  protected ensureControl(): T {
    if (this.control?.parentElement === this) return this.control;
    const found = [...this.children].find(el => el.localName === this.nativeTag) as T | undefined;
    const control = found ?? this.ownerDocument.createElement(this.nativeTag) as T;
    if (!found) {
      control.append(...this.childNodes);
      this.append(control);
    }
    control.classList.add(this.nativeClass);
    this.control = control;
    this.syncAttributes();
    this.syncAccessibility();
    return control;
  }

  protected syncAttributes() { }
  protected syncAccessibility() {
    const control = this.control;
    if (!control) return;
    for (const name of accessibilityAttributes.filter(name => name !== 'id')) {
      if (this.hasAttribute(name)) { control.setAttribute(name, this.getAttribute(name)!); this.forwardedAccessibility.add(name); }
      else if (this.forwardedAccessibility.delete(name)) control.removeAttribute(name);
    }
    if (this.hasAttribute('aria-label') || this.hasAttribute('aria-labelledby')) { this.generatedLabel = false; return; }
    const labels = this.id ? [...this.ownerDocument.querySelectorAll('label')].filter(label => label.htmlFor === this.id) : [];
    if (labels.length) {
      for (const label of labels) if (!label.id) label.id = `px-label-${++nextLabelId}`;
      control.setAttribute('aria-labelledby', labels.map(label => label.id).join(' '));
      this.generatedLabel = true;
    } else if (this.generatedLabel) { control.removeAttribute('aria-labelledby'); this.generatedLabel = false; }
  }
  protected bind(signal: AbortSignal) {
    this.ownerDocument.addEventListener('click', event => {
      const target = event.target as Element;
      const label = target.closest?.('label');
      if (!this.id || label?.htmlFor !== this.id || this.contains(target)) return;
      const control = this.ensureControl();
      if ('disabled' in control && control.disabled) return;
      event.preventDefault();
      control.focus({ preventScroll: true });
      if (control.localName === 'button' || (control.localName === 'input' && ['checkbox', 'radio'].includes((control as HTMLInputElement).type))) control.click();
    }, { signal });
  }

  focus(options?: FocusOptions) { this.ensureControl().focus(options); }
  blur() { this.control?.blur(); }
  click() { this.ensureControl().click(); }
}

export class PxButton extends NativeElement<HTMLButtonElement> {
  protected nativeTag = 'button';
  protected nativeClass = 'px-ui-button';
  static observedAttributes = ['disabled', 'type', 'name', 'value', 'active', 'primary', 'square', 'size', ...accessibilityAttributes];
  attributeChangedCallback(name: string) {
    if (!this.control) return;
    if (['disabled', 'type', 'name', 'value'].includes(name)) {
      if (this.hasAttribute(name)) this.control.setAttribute(name, this.getAttribute(name)!);
      else this.control.removeAttribute(name);
    }
    this.syncAttributes();
    this.syncAccessibility();
  }
  protected syncAttributes() {
    const button = this.control;
    if (!button) return;
    for (const name of ['disabled', 'type', 'name', 'value']) if (this.hasAttribute(name)) button.setAttribute(name, this.getAttribute(name)!);
    if (!button.hasAttribute('type')) button.type = 'button';
    for (const name of ['active', 'primary', 'square']) button.dataset[`px${name[0].toUpperCase()}${name.slice(1)}`] = String(this.hasAttribute(name));
    if (this.hasAttribute('size')) {
      button.dataset.pxSize = '';
      button.style.setProperty('--px-control-size', `${Number(this.getAttribute('size')) || 24}px`);
    } else {
      delete button.dataset.pxSize;
      button.style.removeProperty('--px-control-size');
    }
  }
  get disabled() { return this.ensureControl().disabled; }
  set disabled(value: boolean) { this.toggleAttribute('disabled', !!value); this.ensureControl().disabled = !!value; }
  get value() { return this.ensureControl().value; }
  set value(value: string) { this.ensureControl().value = String(value ?? ''); }
  get name() { return this.ensureControl().name; }
  set name(value: string) { this.ensureControl().name = String(value ?? ''); }
}

/** Shared draft, wheel and drag behavior for native text/number/range controls. */
export class PxInput extends NativeElement<HTMLInputElement> {
  protected nativeTag = 'input';
  protected nativeClass = 'px-ui-input';
  protected forcedType: string | null = null;
  private committed = '';
  private draft = false;
  private scrubCleanup: (() => void) | null = null;
  static observedAttributes = ['value', 'disabled', 'name', 'type', 'min', 'max', 'step', 'placeholder', 'readonly', 'required', 'checked', ...accessibilityAttributes];

  attributeChangedCallback(name: string) {
    if (!this.control) return;
    if (name === 'value') { this.value = this.getAttribute('value') ?? ''; return; }
    if (name === 'id') { this.syncAccessibility(); return; }
    if (this.hasAttribute(name)) this.control.setAttribute(name, this.getAttribute(name)!);
    else this.control.removeAttribute(name);
    if (this.forcedType) this.control.type = this.forcedType;
    this.syncAccessibility();
  }

  protected syncAttributes() {
    if (!this.control) return;
    for (const name of PxInput.observedAttributes) if (name !== 'id' && this.hasAttribute(name)) this.control.setAttribute(name, this.getAttribute(name)!);
    if (this.forcedType) this.control.type = this.forcedType;
    this.committed = this.control.value;
  }

  protected bind(signal: AbortSignal) {
    super.bind(signal);
    const input = this.control!;
    this.addEventListener('input', event => {
      if (event.target !== input) return;
      const focused = this.ownerDocument.activeElement === input;
      if (input.type === 'number' && focused && (input.value === '' || !Number.isFinite(input.valueAsNumber) || input.validity.rangeUnderflow || input.validity.rangeOverflow)) {
        this.draft = true;
        event.stopImmediatePropagation();
        return;
      }
      this.draft = false;
      this.committed = input.value;
    }, { capture: true, signal });
    this.addEventListener('change', event => {
      // Browsers send change before blur. An unfinished number belongs to the
      // draft until blur clamps it and emits the final value exactly once.
      if (event.target === input && this.draft) event.stopImmediatePropagation();
    }, { capture: true, signal });
    input.addEventListener('blur', () => {
      // Overflow palettes can hide an input after an atomic DOM move. The
      // browser reports that blur after layout; keep its unfinished draft.
      if (!this.hasAttribute('data-px-moving') && input.getClientRects().length) this.commitDraft();
    }, { signal });
    input.addEventListener('wheel', event => {
      if (input.matches(':disabled') || (input.type === 'number' && input.readOnly) || !['number', 'range'].includes(input.type)) return;
      event.preventDefault();
      const direction = (event.deltaY || event.deltaX) > 0 ? -1 : 1;
      const step = Number(input.step) || 1;
      this.commit(Number(input.value || 0) + direction * step * (event.shiftKey ? 10 : 1));
    }, { passive: false, signal });
    input.addEventListener('pointerdown', event => {
      // Ordinary dragging belongs to native text selection. Scrubbing is explicit,
      // so double-click, Shift-selection and touch selection keep working too.
      if (input.matches(':disabled') || input.readOnly || input.type !== 'number' || event.button !== 0 || !event.altKey) return;
      event.preventDefault();
      const view = this.ownerDocument.defaultView!;
      const x = event.clientX, start = Number(input.value) || 0, step = Number(input.step) || 1;
      let scrubbing = false;
      this.scrubCleanup?.();
      const move = (next: PointerEvent) => {
        const dx = next.clientX - x;
        if (!scrubbing && Math.abs(dx) < 4) return;
        if (!scrubbing) { scrubbing = true; input.blur(); this.ownerDocument.body.style.cursor = 'ew-resize'; }
        this.commit(start + Math.round(next.shiftKey ? dx / 8 : dx / 3) * step);
      };
      const stop = () => {
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', stop);
        view.removeEventListener('pointercancel', stop);
        this.ownerDocument.body.style.cursor = '';
        this.scrubCleanup = null;
      };
      view.addEventListener('pointermove', move);
      view.addEventListener('pointerup', stop);
      view.addEventListener('pointercancel', stop);
      this.scrubCleanup = stop;
    }, { signal });
  }

  private setNative(value: string) {
    const input = this.ensureControl();
    const prototype = this.ownerDocument.defaultView!.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  }

  private clamp(value: number) {
    const input = this.ensureControl();
    return Math.max(input.min === '' ? -Infinity : Number(input.min), Math.min(input.max === '' ? Infinity : Number(input.max), value));
  }

  private commit(value: number) {
    const input = this.ensureControl();
    const next = String(this.clamp(Number(value.toPrecision(12))));
    if (input.value === next && !this.draft) return;
    this.draft = false;
    this.setNative(next);
    this.committed = next;
    emit(input, 'input');
    emit(input, 'change');
  }

  private commitDraft() {
    if (!this.draft) return;
    const input = this.ensureControl();
    const parsed = Number(input.value);
    const min = input.min === '' ? 0 : Number(input.min);
    const next = this.clamp(input.value !== '' && Number.isFinite(parsed) ? parsed : min);
    this.draft = false;
    this.setNative(String(next));
    const changed = input.value !== this.committed;
    this.committed = input.value;
    if (changed) { emit(input, 'input'); emit(input, 'change'); }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.scrubCleanup?.();
  }

  /** Adopt a native form reset without treating the old unfinished value as a draft. */
  resetDraft() {
    this.draft = false;
    this.committed = this.ensureControl().value;
  }

  get value() { return this.ensureControl().value; }
  set value(value: string | number) {
    const input = this.ensureControl();
    this.committed = String(value ?? '');
    if (this.draft) return;
    input.value = this.committed;
  }
  get disabled() { return this.ensureControl().disabled; }
  set disabled(value: boolean) { this.toggleAttribute('disabled', !!value); this.ensureControl().disabled = !!value; }
  get checked() { return this.ensureControl().checked; }
  set checked(value: boolean) { this.ensureControl().checked = !!value; }
  get name() { return this.ensureControl().name; }
  set name(value: string) { this.ensureControl().name = String(value ?? ''); }
}

export class PxCheckbox extends PxInput {
  protected nativeClass = 'px-ui-checkbox';
  protected forcedType = 'checkbox';
}

export class PxRange extends PxInput {
  protected nativeClass = 'px-ui-range';
  protected forcedType = 'range';
}

export class PxLabel extends NativeElement<HTMLLabelElement> {
  protected nativeTag = 'label';
  protected nativeClass = 'px-ui-label';
  static observedAttributes = ['for', ...accessibilityAttributes];
  attributeChangedCallback(name: string) {
    if (name === 'for' && this.control && !this.hasAttribute('for')) this.control.removeAttribute('for');
    this.syncAttributes(); this.syncAccessibility();
  }
  protected syncAttributes() { if (this.control && this.hasAttribute('for')) this.control.htmlFor = this.getAttribute('for')!; }
}

export class PxMuted extends NativeElement<HTMLSpanElement> {
  protected nativeTag = 'span';
  protected nativeClass = 'px-ui-muted';
}

export class PxSeparator extends HTMLElement { connectedCallback() { installStyles(this.ownerDocument); this.setAttribute('role', 'separator'); } }
export class PxFlex extends HTMLElement {
  static observedAttributes = ['direction', 'reverse', 'inline', 'content', 'items', 'gap', 'grow', 'padding', 'basis', 'inset', 'shrink'];
  connectedCallback() { installStyles(this.ownerDocument); this.update(); }
  attributeChangedCallback() { if (this.isConnected) this.update(); }
  private update() {
    this.style.setProperty('--px-display', this.hasAttribute('inline') ? 'inline-flex' : 'flex');
    this.style.setProperty('--px-direction', `${this.getAttribute('direction') === 'column' ? 'column' : 'row'}${this.hasAttribute('reverse') ? '-reverse' : ''}`);
    for (const name of ['content', 'items', 'grow', 'shrink', 'padding']) {
      if (this.hasAttribute(name)) this.style.setProperty(`--px-${name}`, this.getAttribute(name)!);
      else this.style.removeProperty(`--px-${name}`);
    }
    for (const name of ['gap', 'basis', 'inset']) {
      if (this.hasAttribute(name)) this.style.setProperty(`--px-${name}`, `${Number(this.getAttribute(name)) || 0}px`);
      else this.style.removeProperty(`--px-${name}`);
    }
    this.style.setProperty('--px-position', this.hasAttribute('inset') ? 'absolute' : 'relative');
    this.style.setProperty('--px-overflow', this.hasAttribute('inset') ? 'hidden' : 'visible');
  }
}
export class PxGrid extends HTMLElement { connectedCallback() { installStyles(this.ownerDocument); } }
export class PxPanel extends HTMLElement { connectedCallback() { installStyles(this.ownerDocument); } }
export class PxHead extends HTMLElement { connectedCallback() { installStyles(this.ownerDocument); } }

export function registerPrimitives(registry: CustomElementRegistry = customElements) {
  for (const [name, constructor] of Object.entries({
    'px-button': PxButton, 'px-input': PxInput, 'px-checkbox': PxCheckbox, 'px-range': PxRange,
    'px-label': PxLabel, 'px-muted': PxMuted, 'px-separator': PxSeparator,
    'px-flex': PxFlex, 'px-grid': PxGrid, 'px-panel': PxPanel, 'px-head': PxHead,
  })) defineElement(name, constructor, registry);
}
