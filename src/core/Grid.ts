import { prop, reactive } from "@vicimpa/decorators";

@reactive()
export class Grid {
  @prop size = 16;
  @prop dark = '#555';
  @prop light = '#aaa';

  constructor(size?: number, dark?: string, light?: string) {
    if (size) this.size = size;
    if (dark) this.dark = dark;
    if (light) this.light = light;
  }

  @prop get pattern() {
    const { size, dark, light } = this;
    const can = new OffscreenCanvas(size * 2, size * 2);
    const ctx = can.getContext('2d')!;
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = light;
    ctx.fillRect(size, 0, size, size);
    ctx.fillRect(0, size, size, size);
    return ctx.createPattern(can, 'repeat')!;
  }
}