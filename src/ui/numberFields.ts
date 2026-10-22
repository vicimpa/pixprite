/**
 * Every number field and range slider in the app:
 * - the mouse wheel steps it by 1 (Shift: by 10), clamped to min/max, even without focus;
 * - pressing and dragging sideways scrubs the value; a plain click still places the caret.
 */

const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function commit(input: HTMLInputElement, value: number) {
  const min = input.min !== '' ? +input.min : -Infinity;
  const max = input.max !== '' ? +input.max : Infinity;
  const v = Math.max(min, Math.min(max, Math.round(value)));
  if (String(v) === input.value) return;
  // Through the native setter so React's onChange sees the change
  setter.call(input, String(v));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const isNumber = (t: EventTarget | null): t is HTMLInputElement =>
  t instanceof HTMLInputElement && t.type === 'number' && !t.disabled;

const isRange = (t: EventTarget | null): t is HTMLInputElement =>
  t instanceof HTMLInputElement && t.type === 'range' && !t.disabled;

export function installNumberFields() {
  const ac = new AbortController();
  const { signal } = ac;

  addEventListener('wheel', e => {
    // Range sliders move by their step (Shift: ten steps)
    if (isRange(e.target)) {
      e.preventDefault();
      const input = e.target;
      const step = +input.step || 1;
      const dir = (e.deltaY || e.deltaX) > 0 ? -1 : 1;
      const v = Math.max(+input.min || 0, Math.min(input.max !== '' ? +input.max : 100, +input.value + dir * step * (e.shiftKey ? 10 : 1)));
      if (String(v) === input.value) return;
      setter.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (!isNumber(e.target)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (e.deltaY > 0 || e.deltaX > 0 ? -1 : 1);
    commit(e.target, (+e.target.value || 0) + step);
  }, { passive: false, signal });

  addEventListener('pointerdown', e => {
    const input = e.target;
    if (!isNumber(input) || e.button !== 0) return;
    const sx = e.clientX, start = +input.value || 0;
    let scrubbing = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      if (!scrubbing && Math.abs(dx) < 4) return;
      if (!scrubbing) {
        scrubbing = true;
        input.blur();
        document.body.style.cursor = 'ew-resize';
      }
      // Faster the further you go; Shift for fine steps
      commit(input, start + (ev.shiftKey ? dx / 8 : dx / 3));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    addEventListener('pointermove', move, { signal });
    addEventListener('pointerup', up, { signal });
  }, { signal });

  return () => ac.abort();
}
