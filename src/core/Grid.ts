import { createElement } from "$utils/dom";
import { getContext } from "$utils/misc";
import { prop, reactive } from "@vicimpa/decorators";

const pattern = Symbol('pattern');

@reactive()
export class Grid {

  @prop size = 16;
  @prop dark = '#5a5a5a';
  @prop light = '#a4a4a4';

  @prop get context() {
    const { size, dark, light } = this;
    const can = createElement('canvas');
    const ctx = getContext(can)!;
    can.width = size * 2;
    can.height = size * 2;
    ctx.fillStyle = dark;
    ctx.imageSmoothingEnabled = false;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = light;
    ctx.fillRect(size, 0, size, size);
    ctx.fillRect(0, size, size, size);
    return ctx;
  }

  constructor(size?: number, dark?: string, light?: string) {
    this.resize(size, dark, light);
  }

  resize(size?: number, dark?: string, light?: string) {
    if (size !== undefined)
      this.size = size;
    if (dark !== undefined)
      this.dark = dark;
    if (light !== undefined)
      this.light = light;

    return this;
  }

  getPattern(ctx: CanvasRenderingContext2D & { [pattern]?: CanvasPattern | null; }) {
    return ctx[pattern] ?? (
      ctx[pattern] = ctx.createPattern(this.context.canvas, 'repeat')
    );
  }

  setFill(ctx: CanvasRenderingContext2D) {
    const pattern = this.getPattern(ctx);
    if (!pattern) return;
    ctx.fillStyle = pattern;
  }

  fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
    this.setFill(ctx);
    ctx.fillRect(x, y, width, height);
  }

  fillRectManual(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
    let i = 0, j = 0;
    for (let sx = x; sx < x + width; sx += this.size, i++) {
      for (let sy = y; sy < y + height; sy += this.size, j++) {
        const color = ((i + j) & 1) ? this.dark : this.light;
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, this.size, this.size);
      }
    }
  }
}