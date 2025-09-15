import { Render2D } from "$utils/render";
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
    const render = new Render2D(size * 2);
    const { ctx } = render;
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = light;
    ctx.fillRect(size, 0, size, size);
    ctx.fillRect(0, size, size, size);
    return ctx.createPattern(render, 'repeat')!;
  }
}