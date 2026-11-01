import { pxStyles } from './styles';

export { pxStyles } from './styles';

/** Inline styles work under the extension sandbox's existing CSP. */
export function installStyle(doc: Document, id: string, css: string) {
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = css;
  (doc.head ?? doc.documentElement).append(style);
}

export function installStyles(doc: Document) {
  installStyle(doc, 'pixprite-ui', pxStyles);
}

export function defineElement(name: string, constructor: CustomElementConstructor, registry: CustomElementRegistry = customElements) {
  if (!registry.get(name)) registry.define(name, constructor);
}

export function emit(element: HTMLElement, type: string) {
  const EventClass = element.ownerDocument.defaultView?.Event ?? Event;
  element.dispatchEvent(new EventClass(type, { bubbles: true, composed: true }));
}

/** Preserve properties set on an element before its definition was registered. */
export function upgradeProperties(element: HTMLElement, names: string[]) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const target = element as unknown as Record<string, unknown>;
    const value = target[name];
    delete target[name];
    target[name] = value;
  }
}

export function focusable(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex]:not([tabindex="-1"])');
}
