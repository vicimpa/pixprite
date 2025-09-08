import { createElement } from "$utils/dom";
import { prop, reactive } from "@vicimpa/decorators";
import { Data } from "./Data";

const canA = createElement('canvas');
const ctxA = canA.getContext('2d')!;

const canB = createElement('canvas');
const ctxB = canA.getContext('2d')!;

@reactive()
export class Layer {
  @prop private _data = new Data();

  @prop x = 0;
  @prop y = 0;

  get width() {
    return this._data.width;
  }

  get height() {
    return this._data.height;
  }

  write(data: Data | CanvasRenderingContext2D) {
    if (data instanceof CanvasRenderingContext2D)
      data = Data.fromContext(data);

    canA.width = -this.x + Math.max(this._data.width ?? 0, data.width);
    canA.height = -this.y + Math.max(this._data.height ?? 0, data.height);
    canB.width = data.width;
    canB.height = data.height;
    ctxA.putImageData(this._data, 0, 0);
    ctxB.putImageData(data, 0, 0);
    ctxA.drawImage(canB, -this.x, -this.y);
    this._data = Data.fromContext(ctxA);
  }
}