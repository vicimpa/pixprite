/** Compatibility for extension pages written with native HTML controls. */
import './elements';

type SelectController = HTMLElement & { trigger?: HTMLButtonElement; refresh?: () => void };
const installed = new WeakMap<Document, () => void>();
const owned = 'px-select,px-button,px-input,px-checkbox,px-range,px-color-input,.px-color-popup,.px-menu-list,.px-select-list,[data-px-owned]';
const layoutProperties = ['box-sizing', 'flex', 'align-self', 'order', 'grid-area', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
type LayoutRule = { selector: string; style: CSSStyleDeclaration; specificity: number[]; order: number };

/** Inspect ordinary inline style rules without rewriting extension selectors. */
function layoutRules(doc: Document): LayoutRule[] {
  const out: LayoutRule[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule.type === 1) {
        const style = rule as CSSStyleRule;
        for (const selector of style.selectorText.split(',')) {
          // Functional/namespaced selectors need a full CSS parser; retain the
          // browser's measured fallback for these instead of guessing cascade.
          if (/[()|\\]/.test(selector)) continue;
          const attrs = selector.match(/\[[^\]]*\]/g) ?? [];
          const plain = selector.replace(/\[[^\]]*\]/g, '');
          const ids = plain.match(/#[\w-]+/g) ?? [];
          const classes = plain.match(/\.[\w-]+|:(?!:)[\w-]+/g) ?? [];
          const types = plain.replace(/#[\w-]+|\.[\w-]+|::?[\w-]+/g, ' ').match(/[a-zA-Z][\w-]*/g) ?? [];
          out.push({ selector, style: style.style, specificity: [0, ids.length, attrs.length + classes.length, types.length], order: out.length });
        }
      } else if (rule.type === 4) {
        const media = rule as CSSMediaRule;
        if (doc.defaultView!.matchMedia(media.conditionText).matches) visit(media.cssRules);
      } else if (rule.type === 12) {
        const supports = rule as CSSSupportsRule;
        if (doc.defaultView!.CSS.supports(supports.conditionText)) visit(supports.cssRules);
      }
    }
  };
  for (const sheet of doc.styleSheets) {
    try { if (!sheet.disabled) visit(sheet.cssRules); } catch { /* Cross-origin styles retain their measured layout. */ }
  }
  return out;
}

function preserveLayout(control: HTMLElement, rules: LayoutRule[]) {
  const computed = control.ownerDocument.defaultView!.getComputedStyle(control);
  const matching = rules.filter(rule => { try { return control.matches(rule.selector); } catch { return false; } });
  const values = new Map<string, { value: string; priority: string }>();
  for (const property of layoutProperties) {
    let best: { value: string; priority: string; weight: number[] } | undefined;
    for (const rule of matching) {
      const value = rule.style.getPropertyValue(property);
      if (!value) continue;
      const priority = rule.style.getPropertyPriority(property);
      const weight = [priority ? 1 : 0, ...rule.specificity, rule.order];
      if (!best || weight.some((part, index) => part !== best!.weight[index] && weight.slice(0, index).every((before, i) => before === best!.weight[i]) && part > best!.weight[index])) best = { value, priority, weight };
    }
    const inline = control.style.getPropertyValue(property), priority = control.style.getPropertyPriority(property);
    if (inline && (!best?.priority || priority)) values.set(property, { value: inline, priority });
    else if (best) values.set(property, best);
    else values.set(property, { value: computed.getPropertyValue(property), priority: '' });
  }
  // Preserve authored %, calc(), var() and auto values rather than their current
  // pixel resolution, so controls continue to follow dock/viewport resizing.
  for (const [property, { value, priority }] of values) control.style.setProperty(property, value, priority);
}

/** Adopt native controls; their identity, form association and native events are preserved. */
export function enhanceLegacyControls(doc: Document = document): () => void {
  const previous = installed.get(doc);
  if (previous) return previous;
  const view = doc.defaultView!;
  const scan = (root: ParentNode) => {
    const controls = [...root.querySelectorAll<HTMLElement>('button,input,select')];
    if (root instanceof view.HTMLElement && root.matches('button,input,select')) controls.unshift(root);
    let rules: LayoutRule[] | undefined;
    for (const control of controls) {
      if (!control.isConnected || control.closest(owned)) continue;
      let tag: string;
      if (control.tagName === 'SELECT') {
        const select = control as HTMLSelectElement;
        if (select.multiple || select.size > 1) continue;
        tag = 'px-select';
      } else if (control.tagName === 'BUTTON') tag = 'px-button';
      else {
        const type = (control as HTMLInputElement).type;
        if (type === 'hidden' || type === 'file' || type === 'radio' || type === 'submit' || type === 'reset' || type === 'button') continue;
        tag = type === 'checkbox' ? 'px-checkbox' : type === 'range' ? 'px-range' : type === 'color' ? 'px-color-input' : 'px-input';
      }
      const parent = control.parentNode!;
      const next = control.nextSibling;
      const focused = doc.activeElement === control;
      // A plain HTML button defaults to submit; adoption must keep that default.
      if (tag === 'px-button' && !control.hasAttribute('type')) control.setAttribute('type', (control as HTMLButtonElement).type);
      // Direct-child rules of existing pages stop matching after adoption.
      // Preserve their layout while presentation continues to follow theme vars.
      preserveLayout(control, rules ??= layoutRules(doc));
      const wrapper = doc.createElement(tag) as SelectController;
      if (control.classList.contains('px-primary')) wrapper.setAttribute('primary', '');
      if (control.classList.contains('px-active')) wrapper.setAttribute('active', '');
      wrapper.append(control);
      parent.insertBefore(wrapper, next);
      wrapper.refresh?.();
      if (focused) (tag === 'px-select' ? wrapper.trigger : control)?.focus({ preventScroll: true });
    }
  };
  const start = () => { if (doc.body) scan(doc.body); };
  start();
  doc.addEventListener('DOMContentLoaded', start, { once: true });
  const observer = new view.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof view.HTMLElement) scan(node);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  const stop = () => {
    observer.disconnect();
    doc.removeEventListener('DOMContentLoaded', start);
    installed.delete(doc);
  };
  installed.set(doc, stop);
  return stop;
}
