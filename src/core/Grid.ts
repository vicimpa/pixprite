export class Grid {
  #canvas = document.createElement('canvas');
  #context = this.#canvas.getContext('2d')!;
  #pattern = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

  constructor(size = 16, dark = '#5a5a5a', light = '#a4a4a4') {
    if (!this.#context)
      throw new Error('Can not support 2d context');

    this.resize(size, dark, light);
  }

  resize(size = 16, dark = '#5a5a5a', light = '#a4a4a4') {
    this.#pattern = new WeakMap();
    this.#canvas.width = size * 2;
    this.#canvas.height = size * 2;
    this.#context.fillStyle = dark;
    this.#context.fillRect(0, 0, size * 2, size * 2);
    this.#context.fillStyle = light;
    this.#context.fillRect(size, 0, size, size);
    this.#context.fillRect(0, size, size, size);
    return this;
  }

  toFill(ctx: CanvasRenderingContext2D) {
    var pattern: CanvasPattern | null = this.#pattern.get(ctx) ?? (
      this.#pattern.set(ctx, pattern = ctx.createPattern(this.#canvas, 'repeat')),
      this.#pattern.get(ctx) ?? null
    );

    if (pattern)
      ctx.fillStyle = pattern;

    return this;
  }
}