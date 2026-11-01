import { defineElement, emit, installStyles, upgradeProperties } from './base';

let nextListId = 0;

/** One select implementation for React adapters and extension HTML forms. */
export class PxSelect extends HTMLElement {
  control: HTMLSelectElement | null = null;
  trigger: HTMLButtonElement | null = null;
  private list: HTMLDivElement | null = null;
  private active = -1;
  private observer: MutationObserver | null = null;
  private events: AbortController | null = null;
  private dismissal: AbortController | null = null;
  private originalHidden: HTMLSelectElement['hidden'] = false;
  private typed = '';
  private typedAt = 0;
  private validationShown = false;
  private resetTimer: number | null = null;
  static observedAttributes = ['value', 'disabled', 'name', 'title', 'aria-label', 'aria-labelledby', 'required', 'id'];

  connectedCallback() {
    installStyles(this.ownerDocument);
    queueMicrotask(() => {
      if (!this.isConnected) return;
      this.initialize();
      upgradeProperties(this, ['value', 'disabled', 'name', 'required']);
      this.refresh();
    });
  }

  disconnectedCallback() {
    this.hide();
    this.observer?.disconnect();
    this.observer = null;
    this.events?.abort();
    this.events = null;
    if (this.resetTimer !== null) this.ownerDocument.defaultView!.clearTimeout(this.resetTimer);
    this.resetTimer = null;
    if (this.control) this.control.hidden = this.originalHidden;
  }

  attributeChangedCallback(name: string) {
    if (!this.control) return;
    if (name === 'value') {
      this.control.value = this.getAttribute('value') ?? '';
      const value = this.control.value;
      for (const option of this.control.options) option.defaultSelected = option.value === value;
      this.control.value = value;
    }
    else if (name === 'id') { if (this.isConnected) this.refresh(); return; }
    else if (this.hasAttribute(name)) this.control.setAttribute(name, this.getAttribute(name)!);
    else this.control.removeAttribute(name);
    if (this.isConnected) this.refresh();
  }

  private initialize() {
    if (this.events) return;
    installStyles(this.ownerDocument);
    let select = [...this.children].find(el => el.localName === 'select') as HTMLSelectElement | undefined;
    if (!select) {
      select = this.ownerDocument.createElement('select');
      for (const child of [...this.children]) if (['option', 'optgroup'].includes(child.localName)) select.append(child);
      this.prepend(select);
    }
    const adopted = this.control !== select;
    if (adopted) this.originalHidden = select.hidden;
    this.control = select;
    for (const name of adopted ? PxSelect.observedAttributes : []) {
      if (!this.hasAttribute(name)) continue;
      if (name === 'value') {
        select.value = this.getAttribute(name)!;
        const value = select.value;
        for (const option of select.options) option.defaultSelected = option.value === value;
        select.value = value;
      }
      else if (name === 'id') continue;
      else select.setAttribute(name, this.getAttribute(name)!);
    }
    select.hidden = true;
    if (!this.trigger || this.trigger.parentElement !== this) {
      const trigger = this.ownerDocument.createElement('button');
      trigger.type = 'button';
      trigger.innerHTML = '<span></span><svg width="7" height="4" viewBox="0 0 7 4" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h7v1H0zM1 1h5v1H1zM2 2h3v1H2zM3 3h1v1H3z" fill="currentColor"/></svg>';
      this.append(trigger);
      this.trigger = trigger;
    }
    if (!this.isConnected) return;
    this.events = new AbortController();
    const signal = this.events.signal;
    this.trigger.addEventListener('click', () => this.list ? this.hide() : this.show(), { signal });
    this.trigger.addEventListener('keydown', event => this.keydown(event), { signal });
    this.trigger.addEventListener('blur', event => {
      if (!this.list?.contains(event.relatedTarget as Node | null)) this.hide();
    }, { signal });
    select.addEventListener('change', () => this.refresh(), { signal });
    select.addEventListener('input', () => this.refresh(), { signal });
    // Native labels still point to the retained form control. Forward their
    // activation to the visible trigger without making it submit the form.
    select.addEventListener('click', event => {
      if (event.target !== select || select.disabled) return;
      event.preventDefault();
      if (this.list) this.hide(); else this.show();
    }, { signal });
    this.ownerDocument.addEventListener('click', event => {
      const target = event.target as Element;
      const label = target.closest?.('label');
      if (!this.id || label?.htmlFor !== this.id || this.contains(target) || select.matches(':disabled')) return;
      event.preventDefault();
      if (this.list) this.hide(); else this.show();
    }, { signal });
    select.addEventListener('invalid', event => {
      // The retained native select still blocks invalid form submission. Give
      // its visible trigger the error/focus instead of focusing a hidden node.
      event.preventDefault();
      this.validationShown = true;
      this.refresh();
      this.trigger?.focus({ preventScroll: true });
    }, { signal });
    select.form?.addEventListener('reset', event => {
      if (this.resetTimer !== null) this.ownerDocument.defaultView!.clearTimeout(this.resetTimer);
      this.resetTimer = this.ownerDocument.defaultView!.setTimeout(() => {
        this.resetTimer = null;
        if (!this.isConnected || event.defaultPrevented) return;
        this.validationShown = false;
        this.refresh();
      }, 0);
    }, { signal });
    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(select, { attributes: true, childList: true, subtree: true, characterData: true });
  }

  /** Call after changing native select properties without firing change. */
  refresh() {
    this.initialize();
    const select = this.control!, trigger = this.trigger!;
    trigger.className = `px-select ${select.className}`.trim();
    trigger.style.cssText = select.style.cssText;
    trigger.title = this.getAttribute('title') ?? select.title;
    // The trigger shares the native control's fieldset ancestry, so inherited
    // disabled state remains native and updates when the fieldset changes.
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', String(!!this.list));
    trigger.firstElementChild!.textContent = select.selectedOptions[0]?.label ?? '';
    for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid', 'aria-required', 'aria-errormessage']) {
      const value = this.getAttribute(name) ?? select.getAttribute(name);
      if (value !== null) trigger.setAttribute(name, value); else trigger.removeAttribute(name);
    }
    if (select.required) trigger.setAttribute('aria-required', 'true');
    if (this.validationShown && !select.validity.valid) trigger.setAttribute('aria-invalid', 'true');
    const labels = [...(select.labels ?? []), ...(this.id ? [...this.ownerDocument.querySelectorAll('label')].filter(label => label.htmlFor === this.id) : [])];
    if (!trigger.hasAttribute('aria-label') && !trigger.hasAttribute('aria-labelledby') && labels.length) {
      const label = labels.map(original => {
        const clone = original.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('select,button,input,textarea,px-select').forEach(control => control.remove());
        return clone.textContent?.trim() ?? '';
      }).filter(Boolean).join(' ');
      if (label) trigger.setAttribute('aria-label', label);
    }
    if (select.matches(':disabled')) this.hide();
    if (this.list) this.renderOptions();
  }

  get value() { this.initialize(); return this.control!.value; }
  set value(value: string | number) {
    this.initialize();
    this.control!.value = String(value ?? '');
    this.refresh();
  }
  get disabled() { this.initialize(); return this.control!.disabled; }
  set disabled(value: boolean) {
    this.initialize();
    this.control!.disabled = !!value;
    this.refresh();
  }
  get name() { this.initialize(); return this.control!.name; }
  set name(value: string) { this.initialize(); this.control!.name = String(value ?? ''); }
  get required() { this.initialize(); return this.control!.required; }
  set required(value: boolean) { this.initialize(); this.control!.required = !!value; this.refresh(); }
  focus(options?: FocusOptions) { this.initialize(); this.trigger!.focus(options); }
  blur() { this.trigger?.blur(); }
  click() { this.initialize(); this.trigger!.click(); }

  show() {
    this.initialize();
    if (this.control!.matches(':disabled') || this.list || !this.isConnected) return;
    // Keep a single select popup open in each document.
    for (const other of this.ownerDocument.querySelectorAll<PxSelect>('px-select')) if (other !== this) other.hide();
    const list = this.ownerDocument.createElement('div');
    list.id = `px-select-list-${++nextListId}`;
    list.className = 'px-select-list';
    list.dataset.selectPopup = '';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this.trigger!.getAttribute('aria-label') ?? this.trigger!.title ?? '');
    this.list = list;
    this.active = this.control!.selectedIndex;
    this.renderOptions();
    this.ownerDocument.body.append(list);
    this.position();
    this.mark(this.active);
    this.trigger!.setAttribute('aria-expanded', 'true');
    this.trigger!.setAttribute('aria-controls', list.id);
    this.trigger!.focus({ preventScroll: true });
    list.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
    this.dismissal = new AbortController();
    const signal = this.dismissal.signal;
    const doc = this.ownerDocument, view = doc.defaultView!;
    doc.addEventListener('pointerdown', event => {
      if (!list.contains(event.target as Node) && !this.contains(event.target as Node)) this.hide();
    }, { capture: true, signal });
    // Capture before editor/dialog Escape listeners that bubble at the document.
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.list) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.hide();
      this.trigger?.focus({ preventScroll: true });
    }, { capture: true, signal });
    view.addEventListener('resize', () => this.hide(), { signal });
    view.addEventListener('blur', () => this.hide(), { signal });
    doc.addEventListener('scroll', event => {
      if (!list.contains(event.target as Node)) this.hide();
    }, { capture: true, signal });
  }

  hide() {
    this.dismissal?.abort();
    this.dismissal = null;
    this.list?.remove();
    this.list = null;
    this.trigger?.setAttribute('aria-expanded', 'false');
    this.trigger?.removeAttribute('aria-controls');
    this.trigger?.removeAttribute('aria-activedescendant');
  }

  private options() { return [...this.control!.options]; }
  private enabled(index: number) {
    const option = this.control!.options[index];
    return !!option && !option.disabled && !(option.parentElement?.localName === 'optgroup' && (option.parentElement as HTMLOptGroupElement).disabled);
  }

  private renderOptions() {
    if (!this.list) return;
    const list = this.list;
    list.replaceChildren(...this.options().map((option, index) => {
      const item = this.ownerDocument.createElement('div');
      item.className = 'px-select-item';
      item.id = `${list.id}-${index}`;
      item.textContent = option.label;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === this.control!.selectedIndex));
      item.setAttribute('aria-disabled', String(!this.enabled(index)));
      item.dataset.selected = String(index === this.control!.selectedIndex);
      item.dataset.disabled = String(!this.enabled(index));
      item.dataset.active = String(index === this.active);
      item.addEventListener('pointerenter', () => { if (this.enabled(index)) this.mark(index); });
      item.addEventListener('click', () => this.choose(index));
      return item;
    }));
  }

  private position() {
    const list = this.list!, r = this.trigger!.getBoundingClientRect(), view = this.ownerDocument.defaultView!;
    const margin = 4, width = view.innerWidth, height = view.innerHeight;
    list.style.minWidth = `${Math.min(r.width, Math.max(0, width - margin * 2))}px`;
    list.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
    const below = Math.max(0, height - r.bottom - margin - 1), above = Math.max(0, r.top - margin - 1);
    const down = below >= Math.min(list.offsetHeight, above);
    list.style.maxHeight = `${down ? below : above}px`;
    list.style.left = `${Math.max(margin, Math.min(r.left, width - list.offsetWidth - margin))}px`;
    list.style.top = `${down ? r.bottom + 1 : Math.max(margin, r.top - list.offsetHeight - 1)}px`;
  }

  private mark(index: number) {
    if (!this.list) return;
    this.active = index;
    for (const [i, item] of [...this.list.children].entries()) (item as HTMLElement).dataset.active = String(i === index);
    const item = this.list.children[index] as HTMLElement | undefined;
    if (!item) return;
    this.trigger!.setAttribute('aria-activedescendant', item.id);
    const top = item.offsetTop, bottom = top + item.offsetHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
  }

  private choose(index: number) {
    if (!this.enabled(index)) return;
    const select = this.control!;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    this.hide();
    this.refresh();
    this.trigger!.focus({ preventScroll: true });
    if (changed) { emit(select, 'input'); emit(select, 'change'); }
  }

  private step(from: number, direction: number) {
    for (let i = from + direction; i >= 0 && i < this.control!.options.length; i += direction) if (this.enabled(i)) return i;
    return from;
  }

  private keydown(event: KeyboardEvent) {
    event.stopPropagation();
    const { key } = event;
    const open = !!this.list;
    if (key === 'Tab') { this.hide(); return; }
    if (key === 'Escape') { if (open) { event.preventDefault(); this.hide(); } return; }
    if (event.altKey && (key === 'ArrowDown' || key === 'ArrowUp')) { event.preventDefault(); this.show(); return; }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const direction = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
      const from = open ? this.active : this.control!.selectedIndex;
      const next = key === 'Home' ? this.step(-1, 1) : key === 'End' ? this.step(this.control!.options.length, -1) : this.step(from, direction);
      if (open) this.mark(next); else this.choose(next);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) this.choose(this.active); else this.show();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      this.typed = now - this.typedAt > 750 ? key : this.typed + key;
      this.typedAt = now;
      const options = this.options(), start = open ? this.active : this.control!.selectedIndex;
      for (let offset = 1; offset <= options.length; offset++) {
        const index = (start + offset + options.length) % options.length;
        if (!this.enabled(index) || !options[index].label.toLocaleLowerCase().startsWith(this.typed.toLocaleLowerCase())) continue;
        if (open) this.mark(index); else this.choose(index);
        break;
      }
    }
  }
}

export function registerSelect(registry: CustomElementRegistry = customElements) {
  defineElement('px-select', PxSelect, registry);
}
