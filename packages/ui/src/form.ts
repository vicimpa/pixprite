import { defineElement, installStyle } from './base';
import { registerPrimitives, type PxInput } from './primitives';
import { registerSelect, type PxSelect } from './select';
import { registerColorInput, type PxColorInputElement } from './color-input';

import { fieldDefault, formDefaults, type FormField, type FormSchema, type FormValue, type FormValues } from './form-values';
export { formDefaults, type FormField, type FormSchema, type FormValue, type FormValues } from './form-values';

type BoundControl = { element: HTMLElement; native: HTMLInputElement | HTMLSelectElement };
type BoundField = { row: HTMLElement; signature: string; field: FormField; controls: BoundControl[]; connect: () => void; cleanup: () => void };
let nextId = 0;
const css = `px-form{display:contents}.px-form-fields{display:flex;flex-direction:column;gap:6px}px-form[inline]>.px-form-fields{flex-direction:row;align-items:center;gap:8px}.px-form-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.px-form-caption{min-width:6em;color:var(--fg-dim)}.px-form-check>.px-form-caption{min-width:0;color:inherit}px-form[inline] .px-form-caption{min-width:0;color:inherit}.px-form-check{display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap}`;

/** Declarative controls with stable native DOM, shared by editor forms and panels. */
export class PxFormElement extends HTMLElement {
  static observedAttributes = ['inline'];
  private _schema: FormSchema = [];
  private _values: FormValues = {};
  private _palette: string[] = [];
  private fields = new Map<string, BoundField>();
  private container?: HTMLElement;
  private structureDirty = true;
  private fieldPrefix = `px-form-${++nextId}`;
  private resetController?: AbortController;
  private resetTimer: number | null = null;
  get schema() { return this._schema; }
  set schema(value: FormSchema) { this._schema = value; this._values = { ...formDefaults(value, this._values), ...this._values }; this.structureDirty = true; this.render(); }
  get values() { return this._values; }
  set values(value: FormValues) { this._values = { ...formDefaults(this.schema, value), ...value }; this.syncValues(); }
  get palette() { return this._palette; }
  set palette(value: string[]) { this._palette = value; this.syncValues(); }
  get inline() { return this.hasAttribute('inline'); }
  set inline(value: boolean) { this.toggleAttribute('inline', value); }
  attributeChangedCallback() { }
  connectedCallback() {
    installStyle(this.ownerDocument, 'pixprite-ui-form', css);
    this.listenForReset();
    for (const bound of this.fields.values()) bound.connect();
    if (this.structureDirty || !this.container) this.render();
  }
  disconnectedCallback() {
    for (const bound of this.fields.values()) bound.cleanup();
    this.resetController?.abort(); this.resetController = undefined;
    if (this.resetTimer !== null) this.ownerDocument.defaultView!.clearTimeout(this.resetTimer);
    this.resetTimer = null;
  }
  connectedMoveCallback() { }

  private listenForReset() {
    this.resetController?.abort(); this.resetController = new AbortController();
    this.closest('form')?.addEventListener('reset', event => {
      const view = this.ownerDocument.defaultView!;
      if (this.resetTimer !== null) view.clearTimeout(this.resetTimer);
      // The reset event precedes the browser's native default-value restoration.
      this.resetTimer = view.setTimeout(() => {
        this.resetTimer = null;
        if (!this.isConnected || event.defaultPrevented) return;
        const next = { ...this.values };
        for (const [key, { field, controls }] of this.fields) {
          for (const { element } of controls) if (['px-input', 'px-range', 'px-checkbox'].includes(element.localName)) (element as PxInput).resetDraft();
          const native = controls[0]?.native;
          if (!native) continue;
          if (field.type === 'checkbox') next[key] = (native as HTMLInputElement).checked;
          else if (field.type === 'slider' || field.type === 'number' || field.type === 'layer' || field.type === 'tag') next[key] = Number(native.value);
          else if (field.type === 'select') next[key] = field.options?.find(option => String(option.value) === native.value)?.value ?? native.value;
          else next[key] = native.value;
        }
        const changed = Object.keys(next).some(key => this.values[key] !== next[key]);
        this._values = next; this.syncValues();
        if (changed) this.notify();
      }, 0);
    }, { signal: this.resetController.signal });
  }

  private render() {
    if (!this.isConnected) return;
    if (!this.container) { this.container = this.ownerDocument.createElement('div'); this.container.className = 'px-form-fields'; this.append(this.container); }
    const keys = new Set(this.schema.map(field => field.key));
    for (const [key, bound] of this.fields) if (!keys.has(key)) { bound.cleanup(); bound.row.remove(); this.fields.delete(key); }
    this.schema.forEach((field, index) => {
      const signature = JSON.stringify(field);
      let bound = this.fields.get(field.key);
      if (!bound || bound.signature !== signature) {
        const previous = bound;
        bound = this.createField(field, signature);
        if (previous) { previous.cleanup(); previous.row.replaceWith(bound.row); }
        this.fields.set(field.key, bound);
      }
      const before = this.container!.children[index] ?? null;
      if (before !== bound.row) {
        const container = this.container as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
        if (container.moveBefore && bound.row.isConnected) container.moveBefore(bound.row, before);
        else container.insertBefore(bound.row, before);
      }
    });
    this.structureDirty = false;
    this.syncValues();
  }

  private createField(field: FormField, signature: string): BoundField {
    const doc = this.ownerDocument, row = doc.createElement(field.type === 'checkbox' ? 'label' : 'div');
    row.className = field.type === 'checkbox' ? 'px-form-check' : 'px-form-row'; row.dataset.field = field.key;
    const caption = doc.createElement(field.type === 'checkbox' ? 'span' : 'label');
    caption.textContent = field.label; caption.className = 'px-form-caption';
    const id = `${this.fieldPrefix}-${encodeURIComponent(field.key)}`;
    if (caption.tagName === 'LABEL') (caption as HTMLLabelElement).htmlFor = id;
    if (field.type !== 'checkbox') row.append(caption);
    const controls: BoundControl[] = [];
    const listeners: { control: HTMLElement; event: string; callback: () => void }[] = [];
    let controller: AbortController | undefined;
    const listen = (control: HTMLElement, event: string, callback: () => void) => listeners.push({ control, event, callback });
    const add = (tag: string, native: HTMLInputElement | HTMLSelectElement, event: string, read: () => FormValue) => {
      const element = doc.createElement(tag);
      native.id = controls.length ? `${id}-${controls.length}` : id;
      if (!controls.length) native.name = field.key;
      native.setAttribute('aria-label', field.label);
      const initial = this.values[field.key] ?? field.default ?? fieldDefault(field);
      if (native instanceof this.ownerDocument.defaultView!.HTMLInputElement) {
        if (field.type === 'checkbox') native.defaultChecked = !!initial;
        else native.defaultValue = String(initial);
      } else for (const option of native.options) option.defaultSelected = option.value === String(initial);
      element.append(native); row.append(element); controls.push({ element, native });
      listen(native, event, () => this.change(field.key, read()));
      return element;
    };
    const number = (type: 'number' | 'range') => {
      const input = doc.createElement('input'); input.type = type;
      if (field.min !== undefined || type === 'range') input.min = String(field.min ?? 0);
      if (field.max !== undefined || type === 'range') input.max = String(field.max ?? 100);
      input.step = String(field.step ?? 1);
      if (type === 'number' && field.type !== 'slider') input.style.width = '5em';
      return add(type === 'range' ? 'px-range' : 'px-input', input, 'input', () => Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, Number(input.value) || 0)));
    };
    switch (field.type) {
      case 'slider': number('range'); number('number'); break;
      case 'number': number('number'); break;
      case 'checkbox': {
        const input = doc.createElement('input'); input.type = 'checkbox';
        add('px-checkbox', input, 'change', () => input.checked); row.append(caption); break;
      }
      case 'color': {
        const input = doc.createElement('input'); input.type = 'color';
        const element = add('px-color-input', input, 'change', () => input.value);
        element.title = field.label; element.setAttribute('aria-label', field.label); break;
      }
      case 'select': case 'layer': case 'tag': {
        const select = doc.createElement('select');
        for (const option of field.options ?? []) { const child = doc.createElement('option'); child.value = String(option.value); child.textContent = option.label; select.append(child); }
        add('px-select', select, 'change', () => field.type === 'layer' || field.type === 'tag' ? Number(select.value) : field.options?.find(option => String(option.value) === select.value)?.value ?? select.value);
        break;
      }
      default: {
        const input = doc.createElement('input'); input.type = 'text'; input.style.width = '12em';
        add('px-input', input, 'input', () => input.value);
      }
    }
    const connect = () => {
      controller?.abort(); controller = new AbortController();
      for (const { control, event, callback } of listeners) control.addEventListener(event, callback, { signal: controller.signal });
    };
    connect();
    return { row, signature, field, controls, connect, cleanup: () => { controller?.abort(); controller = undefined; } };
  }

  private syncValues() {
    for (const [key, { field, controls }] of this.fields) {
      const value = this.values[key] ?? field.default ?? fieldDefault(field);
      for (const { element, native } of controls) {
        if (field.type === 'checkbox') {
          native instanceof this.ownerDocument.defaultView!.HTMLInputElement && (native.checked = !!value);
        } else if (element.localName === 'px-color-input') {
          const color = element as PxColorInputElement; color.value = String(value);
          if (color.palette !== this.palette) color.palette = this.palette;
        } else if (element.localName === 'px-select') {
          (element as PxSelect).value = String(value);
        } else (element as PxInput).value = typeof value === 'number' ? value : String(value);
      }
    }
  }

  private change(key: string, value: FormValue) {
    this._values = { ...this.values, [key]: value };
    this.syncValues();
    this.notify();
  }
  private notify() { this.dispatchEvent(new CustomEvent<FormValues>('valuechange', { bubbles: true, composed: true, detail: { ...this.values } })); }
}

export function registerForm(registry: CustomElementRegistry = customElements) {
  registerPrimitives(registry); registerSelect(registry); registerColorInput(registry);
  defineElement('px-form', PxFormElement, registry);
}
