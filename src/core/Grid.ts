import { prop, reactive } from "@vicimpa/decorators";

@reactive()
export class Grid {

  @prop size = 16;
  @prop dark = '#5a5a5a';
  @prop light = '#a4a4a4';

  @prop get canvas() {
    const can = document.createElement('canvas');
    const ctx = can.getContext('2d')!;
    const { size, dark, light } = this;
    can.width = size * 2;
    can.height = size * 2;
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = light;
    ctx.fillRect(size, 0, size, size);
    ctx.fillRect(0, size, size, size);
    return can;
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

  getPattern(ctx: CanvasRenderingContext2D) {
    return ctx.createPattern(this.canvas, 'repeat');
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
}