import { defineElement } from './base';
import { installCompositeStyles } from './composite-styles';
import { trackPointer } from './pointer';

/** A light-DOM dialog surface. Editor wrappers can supply their existing form. */
export class PxDialogElement extends HTMLElement {
  private cleanup?: () => void;
  private connection = 0;
  private previousFocus?: HTMLElement;
  private cancelDrag?: () => void;
  get open() { return this.hasAttribute('open'); }
  set open(value: boolean) { this.toggleAttribute('open', value); }
  connectedCallback() {
    installCompositeStyles(this.ownerDocument);
    const connection = ++this.connection;
    // React and DOM adapters append their supplied form after connecting the host.
    queueMicrotask(() => { if (this.isConnected && this.connection === connection) this.initialize(); });
  }
  private initialize() {
    this.cleanup?.();
    if (!this.querySelector('form')) {
      const form = this.ownerDocument.createElement('form');
      form.className = 'px-dialog-window';
      const title = this.ownerDocument.createElement('div');
      title.className = 'px-dialog-title';
      title.textContent = this.getAttribute('heading') ?? this.getAttribute('aria-label') ?? '';
      const body = this.ownerDocument.createElement('div');
      body.className = 'px-dialog-body';
      while (this.firstChild) body.append(this.firstChild);
      form.append(title, body); this.append(form);
    }
    const form = this.querySelector('form')!;
    if (!this.contains(this.ownerDocument.activeElement)) this.previousFocus = this.ownerDocument.activeElement as HTMLElement | undefined;
    form.classList.add('px-dialog-window');
    form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true');
    const label = this.getAttribute('heading') ?? this.getAttribute('aria-label');
    if (label) form.setAttribute('aria-label', label);
    const view = this.ownerDocument.defaultView!;
    const key = (event: KeyboardEvent) => {
      if (!this.open || event.defaultPrevented) return;
      // A select/color picker or nested dialog owns Escape before its parent.
      if (this.ownerDocument.querySelector('[data-select-popup], .px-color-popup, .px-menu-list')) return;
      const dialogs = [...this.ownerDocument.querySelectorAll('px-dialog[open]')];
      if (dialogs.at(-1) !== this) return;
      if (event.key === 'Tab') {
        const stops = [...form.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length);
        const active = this.ownerDocument.activeElement;
        const edge = event.shiftKey ? stops[0] : stops.at(-1);
        if (!stops.length || active === edge || !form.contains(active)) {
          event.preventDefault(); (event.shiftKey ? stops.at(-1) : stops[0])?.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); this.close();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target as Element).closest('.px-dialog-title') || (event.target as Element).closest('button')) return;
      this.cancelDrag?.();
      const r = form.getBoundingClientRect(); let x = r.left, y = r.top;
      form.style.willChange = 'transform';
      this.cancelDrag = trackPointer(event, form, (dx, dy) => {
        x = Math.max(0, Math.min(view.innerWidth - 40, r.left + dx));
        y = Math.max(0, Math.min(view.innerHeight - 20, r.top + dy));
        form.style.transform = `translate3d(${x - r.left}px,${y - r.top}px,0)`;
      }, () => { this.cancelDrag = undefined; Object.assign(form.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, margin: '0', transform: '', willChange: '' }); });
    };
    const submit = (event: SubmitEvent) => {
      if (event.target !== form) return;
      event.preventDefault();
      if (this.dispatchEvent(new Event('px-submit', { bubbles: true, cancelable: true }))) this.close();
    };
    const click = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('px-dialog') === this && target.closest('[data-dialog-close]')) this.close();
    };
    view.addEventListener('keydown', key, true); this.addEventListener('pointerdown', down); form.addEventListener('submit', submit); this.addEventListener('click', click);
    this.cleanup = () => { view.removeEventListener('keydown', key, true); this.removeEventListener('pointerdown', down); form.removeEventListener('submit', submit); this.removeEventListener('click', click); };
    queueMicrotask(() => {
      if (!this.isConnected || !this.open) return;
      const visible = (element: HTMLElement) => !(element as HTMLInputElement).disabled && !!element.getClientRects().length;
      const field = [...form.querySelectorAll<HTMLElement>('input,select,textarea,.px-select,.px-color-swatch')].find(visible)
        ?? [...form.querySelectorAll<HTMLElement>('button,[tabindex]:not([tabindex="-1"])')].find(visible);
      field?.focus({ preventScroll: true });
    });
  }
  disconnectedCallback() {
    ++this.connection; this.cleanup?.(); this.cleanup = undefined; this.cancelDrag?.(); this.cancelDrag = undefined;
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
  close() {
    if (!this.dispatchEvent(new Event('px-close', { bubbles: true, cancelable: true }))) return;
    this.open = false;
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}

export function registerDialog(registry: CustomElementRegistry = customElements) { defineElement('px-dialog', PxDialogElement, registry); }
