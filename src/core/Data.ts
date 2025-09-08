export class Data extends ImageData {
  public width = 0;
  public height = 0;

  constructor(
    data?: ImageData,
  ) {
    if (data)
      super(data.data, data.width, data.height);
    else
      super(1, 1);
  }

  static fromContext(ctx: CanvasRenderingContext2D) {
    const { width, height } = ctx.canvas;
    return new Data(ctx.getImageData(0, 0, width, height));
  }
}