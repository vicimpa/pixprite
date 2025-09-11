export class Render extends OffscreenCanvas {
  constructor();
  constructor(size: number);
  constructor(width: number, height: number);
  constructor(width = 1, height = width) {
    super(width, height);
  }
}