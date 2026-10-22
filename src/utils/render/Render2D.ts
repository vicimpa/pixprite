import { Render } from "./Render";

export class Render2D extends Render {
  ctx = this.getContext('2d')!;
}