const $ctx = Symbol('context');

export function getContext(
  can: HTMLCanvasElement & { [$ctx]?: CanvasRenderingContext2D; },
  options?: CanvasRenderingContext2DSettings
) {
  return can[$ctx] ?? (
    can[$ctx] = can.getContext('2d', options)!
  );
}

