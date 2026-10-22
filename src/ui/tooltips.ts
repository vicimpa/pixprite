import { keyNames } from "~/core/i18n";
/**
 * App-wide tooltips for every element with a `title`.
 * Shown after a short still hover, switch instantly while one is already up ("warm"),
 * hide on press or leave. The native tooltip is suppressed by moving `title` aside while hovered.
 */

const DELAY = 300;
const WARM_FOR = 400;

export function installTooltips() {
  const ac = new AbortController();
  const { signal } = ac;
  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  document.body.appendChild(tip);

  let target: HTMLElement | null = null;
  let timer = 0;
  let coolTimer = 0;
  let warm = false;

  const restore = () => {
    if (target?.dataset.tip !== undefined) {
      target.title = target.dataset.tip;
      delete target.dataset.tip;
    }
  };

  const hide = () => {
    clearTimeout(timer);
    if (tip.style.display === 'block') {
      // Moving to a neighbour soon after keeps tooltips instant
      warm = true;
      clearTimeout(coolTimer);
      coolTimer = window.setTimeout(() => { warm = false; }, WARM_FOR);
    }
    tip.style.display = 'none';
    restore();
    target = null;
  };

  const show = () => {
    if (!target?.isConnected) return;
    // Titles arrive translated; key names still follow the system (Ctrl → ⌘ on a Mac)
    tip.textContent = keyNames(target.dataset.tip ?? '');
    if (!tip.textContent) return;
    tip.style.display = 'block';
    const r = target.getBoundingClientRect();
    const b = tip.getBoundingClientRect();
    // Below the element, flipped above near the bottom, kept inside the window
    let y = r.bottom + 6;
    if (y + b.height > innerHeight - 4) y = r.top - b.height - 6;
    const x = Math.max(4, Math.min(innerWidth - b.width - 4, r.left + r.width / 2 - b.width / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  };

  addEventListener('pointerover', e => {
    const el = (e.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
    if (el === target) return;
    const wasShown = tip.style.display === 'block';
    hide();
    if (!el || (!el.title && el.dataset.tip === undefined)) return;
    target = el;
    if (el.title) {
      el.dataset.tip = el.title;
      el.removeAttribute('title');
    }
    if (warm || wasShown) show();
    else timer = window.setTimeout(show, DELAY);
  }, { signal });

  addEventListener('pointerout', e => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide();
  }, { signal });
  addEventListener('wheel', hide, { signal, passive: true });
  addEventListener('pointerdown', () => { warm = false; hide(); }, { signal, capture: true });
  addEventListener('keydown', hide, { signal });
  addEventListener('blur', hide, { signal });

  return () => { hide(); tip.remove(); ac.abort(); };
}
