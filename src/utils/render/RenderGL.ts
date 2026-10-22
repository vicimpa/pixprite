import { Render } from "./Render";

export class RenderGL extends Render {
  gl = this.getContext('webgl2')!;
}