import { defineElement, installStyle } from './base';

export class PxVariables extends HTMLElement {
  private names = new Set<string>();
  private values: Record<string, string | number | null | undefined> = {};
  get variables() { return this.values; }
  set variables(values: Record<string, string | number | null | undefined>) {
    for (const name of this.names) if (!(name in values)) this.style.removeProperty(`--${name}`);
    this.names = new Set(Object.keys(values)); this.values = values;
    for (const [name, value] of Object.entries(values)) {
      if (value === null || value === undefined) this.style.removeProperty(`--${name}`);
      else this.style.setProperty(`--${name}`, String(value));
    }
  }
  connectedCallback() { this.style.display = 'contents'; }
}

const css = `px-tooltip{position:fixed;z-index:2000;display:none;max-width:320px;padding:3px 7px;color:var(--tooltip-fg);background:var(--tooltip);border:1px solid var(--b1);box-shadow:2px 2px 0 var(--shadow);font:inherit;white-space:pre-line;pointer-events:none;box-sizing:border-box}`;
export class PxTooltip extends HTMLElement {
  format: (text: string) => string = text => text;
  private cleanup?: () => void;
  private target: HTMLElement | null = null;
  private timer = 0;
  private cool = 0;
  private warm = false;
  connectedCallback() {
    this.cleanup?.();
    const doc = this.ownerDocument, view = doc.defaultView!;
    installStyle(doc, 'pixprite-ui-tooltip', css);
    const controller = new AbortController(), { signal } = controller;
    const show = () => {
      const target = this.target; if (!target?.isConnected) return;
      this.textContent = this.format(target.dataset.tip ?? ''); if (!this.textContent) return;
      this.style.display = 'block';
      const r = target.getBoundingClientRect(), b = this.getBoundingClientRect();
      let y = r.bottom + 6; if (y + b.height > view.innerHeight - 4) y = r.top - b.height - 6;
      this.style.left = `${Math.max(4, Math.min(view.innerWidth - b.width - 4, r.left + r.width / 2 - b.width / 2))}px`;
      this.style.top = `${Math.max(4, y)}px`;
    };
    view.addEventListener('pointerover', event => {
      const element = (event.target as Element | null)?.closest?.<HTMLElement>('[title],[data-tip]') ?? null;
      if (element === this.target) return;
      const shown = this.style.display === 'block'; this.hide();
      if (!element || (!element.title && element.dataset.tip === undefined)) return;
      this.target = element;
      if (element.title) { element.dataset.tip = element.title; element.removeAttribute('title'); }
      if (this.warm || shown) show(); else this.timer = view.setTimeout(show, 300);
    }, { signal });
    view.addEventListener('pointerout', event => { if (this.target && !this.target.contains(event.relatedTarget as Node | null)) this.hide(); }, { signal });
    view.addEventListener('wheel', () => this.hide(), { signal, passive: true });
    view.addEventListener('pointerdown', () => { this.warm = false; this.hide(); }, { signal, capture: true });
    view.addEventListener('keydown', () => this.hide(), { signal }); view.addEventListener('blur', () => this.hide(), { signal });
    this.cleanup = () => { controller.abort(); this.hide(); view.clearTimeout(this.cool); };
  }
  private hide() {
    const view = this.ownerDocument.defaultView!;
    view.clearTimeout(this.timer);
    if (this.style.display === 'block') { this.warm = true; view.clearTimeout(this.cool); this.cool = view.setTimeout(() => { this.warm = false; }, 400); }
    this.style.display = 'none';
    if (this.target?.dataset.tip !== undefined) { this.target.title = this.target.dataset.tip; delete this.target.dataset.tip; }
    this.target = null;
  }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; }
}

export function registerPresentation(registry: CustomElementRegistry = customElements) {
  defineElement('px-variables', PxVariables, registry); defineElement('px-tooltip', PxTooltip, registry);
}
