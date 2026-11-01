import { trackPointer as capturePointer } from '@pixprite/ui/elements';

/** React event adapter for the shared native pointer-capture controller. */
export function trackPointer(
  event: { button: number; pointerId: number; clientX: number; clientY: number; currentTarget: EventTarget | null; preventDefault(): void },
  move: (dx: number, dy: number) => void,
  finish: () => void,
) {
  if (event.button !== 0) return;
  return capturePointer(event as PointerEvent, event.currentTarget as HTMLElement, move, finish);
}
