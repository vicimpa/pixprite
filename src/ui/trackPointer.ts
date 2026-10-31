/** Capture a drag without routing every pointer sample through React. */
export function trackPointer(
  event: { button: number; pointerId: number; clientX: number; clientY: number; currentTarget: EventTarget | null; preventDefault(): void },
  move: (dx: number, dy: number) => void,
  finish: () => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  const id = event.pointerId, x = event.clientX, y = event.clientY;
  element.setPointerCapture(id);
  let active = true;
  const update = (e: PointerEvent) => { if (e.pointerId === id) move(e.clientX - x, e.clientY - y); };
  const end = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    if (e.type === 'pointerup') update(e);
    active = false;
    element.removeEventListener('pointermove', update);
    element.removeEventListener('pointerup', end);
    element.removeEventListener('pointercancel', end);
    element.removeEventListener('lostpointercapture', end);
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    finish();
  };
  element.addEventListener('pointermove', update);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('lostpointercapture', end);
}
