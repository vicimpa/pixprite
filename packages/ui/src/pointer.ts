/** Pointer capture shared by controls in the editor and sandboxed panels. */
export function trackPointer(event: PointerEvent, element: HTMLElement, move: (dx: number, dy: number, event: PointerEvent) => void, finish: () => void) {
  const id = event.pointerId, x = event.clientX, y = event.clientY;
  event.preventDefault();
  element.setPointerCapture(id);
  let active = true;
  const update = (e: PointerEvent) => { if (e.pointerId === id) move(e.clientX - x, e.clientY - y, e); };
  const dispose = () => {
    if (!active) return;
    active = false;
    element.removeEventListener('pointermove', update);
    element.removeEventListener('pointerup', end);
    element.removeEventListener('pointercancel', end);
    element.removeEventListener('lostpointercapture', end);
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    finish();
  };
  const end = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    if (e.type === 'pointerup') update(e);
    dispose();
  };
  element.addEventListener('pointermove', update);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('lostpointercapture', end);
  return dispose;
}
