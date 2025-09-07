import { Component } from "react";
import { prop, reactive } from "@vicimpa/decorators";
import { Color } from "$core/Color";
import { array, clamp, dispose } from "$utils/misc";
import { batch, computed, effect, signal } from "@preact/signals-react";
import { InfoView } from "../InfoView";
import { ColorInfo } from "./ColorInfo";
import { connect } from "@vicimpa/react-decorators";
import detectUnselect from "./plugins/detectUnselect";
import { paletteCollection } from "./palettes";
import { Panel } from "$ui/Panel";
import { Canvas } from "$ui/Canvas";
import { signalRef } from "$utils/signal";
import { vec2 } from "@vicimpa/glm";
import detectResize from "./plugins/detectResize";
import { Grid } from "$core/Grid";
import { MouseButton } from "$utils/mouse";
import detectInput from "./plugins/detectInput";

const DEFAULT_PALETTE = await paletteCollection[0].fetch();

export type ColorListProps = {
  editable?: boolean;
  onChange?: (color: Color, alt: boolean) => any;
};

@connect(detectUnselect, detectResize, detectInput)
@reactive()
export class ColorList extends Component<ColorListProps> {
  ref = signalRef<HTMLDivElement>();

  grid = new Grid(8);

  @prop mouse = vec2(-Infinity);
  @prop mouseIndex = -1;

  @prop data = array(1024, (i) => signal(DEFAULT_PALETTE[i]?.clone() ?? new Color()));
  @prop size = DEFAULT_PALETTE.length;
  @prop colorSize = 16;

  @prop indexA?: number;
  @prop indexB?: number;

  @prop viewSize = vec2();

  @prop scroll = 0;
  @prop get length() {
    return Math.min(this.data.length, this.size);
  }
  @prop get rowSize() {
    const { colorSize } = this, { width } = this.viewSize;
    return (width - 10) / colorSize | 0;
  }
  @prop get maxScroll() {
    const { colorSize, rowSize, length } = this, { height } = this.viewSize;
    return Math.max(0, Math.ceil(length / rowSize) * colorSize - height);
  };

  @prop draggingScroll = false;
  @prop dragOffset = 0;

  loadColors(colors: Color[]) {
    batch(() => {
      const size = Math.min(this.data.length, colors.length);
      for (let i = 0; i < size; i++) {
        this.data[i].value = colors[i].clone();
      }
      this.size = size;
      this.indexA = undefined;
      this.indexB = undefined;
    });
  }

  setColor(color: Color, alt: boolean) {
    batch(() => {
      if (!alt && this.indexA !== undefined) {
        if (this.props.editable)
          this.data[this.indexA].value = color.clone();
        else
          this.indexA = undefined;
        return;
      }

      if (alt && this.indexB !== undefined) {
        if (this.props.editable)
          this.data[this.indexB].value = color.clone();
        else
          this.indexB = undefined;
        return;
      }
    });
  }

  setSize(size: number) {
    this.colorSize = size;
  }

  colorInfo = computed(() => (
    this.mouseIndex === -1 ? null : (
      <ColorInfo
        color={this.data[this.mouseIndex].value}
        prefix={`Index ${this.mouseIndex}`} />
    )
  ));

  render() {
    return (
      <InfoView.Item info={this.colorInfo}>
        <Panel ref={this.ref} className="grow-1 relative">
          <Canvas
            className="absolute inset-0 m-auto"
            onWheel={e => {
              this.scroll += e.deltaY;
            }}
            onMouseMove={({ nativeEvent: e }) => {
              this.mouse = vec2(e.offsetX, e.offsetY);
            }}
            onMouseDown={({ nativeEvent: e, button }) => {
              const { width, height } = this.viewSize;
              const { maxScroll } = this;

              if (button === MouseButton.LEFT && maxScroll > 0) {
                const handleHeight = Math.max(20, height * (height / (height + maxScroll)));
                const handleY = (this.scroll / maxScroll) * (height - handleHeight);
                const xInBar = e.offsetX >= width - 10;
                const yInHandle = e.offsetY >= handleY && e.offsetY <= handleY + handleHeight;

                if (xInBar && yInHandle) {
                  this.draggingScroll = true;
                  this.dragOffset = e.offsetY - handleY;
                  return;
                }
              }

              const i = this.mouseIndex;
              if (i === -1)
                return;

              if (button === MouseButton.MIDDLE)
                return;

              batch(() => {
                if (button === MouseButton.LEFT) {
                  this.indexA = this.indexA === i ? undefined : i;
                  this.indexB = this.indexB === i ? undefined : this.indexB;

                  if (this.indexA !== undefined)
                    this.props.onChange?.(this.data[i].value.clone(), false);
                }

                if (button === MouseButton.RIGHT) {
                  this.indexA = this.indexA === i ? undefined : this.indexA;
                  this.indexB = this.indexB === i ? undefined : i;

                  if (this.indexB !== undefined)
                    this.props.onChange?.(this.data[i].value.clone(), true);
                }
              });
            }}
            draw={(can, ctx) => {
              const { width, height } = this.viewSize;
              const { colorSize, scroll, maxScroll, rowSize, length } = this;

              this.scroll = clamp(scroll, 0, maxScroll);

              if (!vec2(can.width, can.height).equals(this.viewSize)) {
                can.width = width;
                can.height = height;
              }

              ctx.clearRect(0, 0, width, height);

              const paths: Path2D[] = [];
              const effects: (() => void)[] = [];
              const bsize = colorSize / 8 | 0;
              const dbsize = bsize / 2;
              const scolorSize = colorSize / 4;

              for (let i = 0; i < length; i++) {
                const x = ((i % rowSize | 0) * colorSize);
                const y = ((i / rowSize | 0) * colorSize) - scroll;
                const path = new Path2D();
                const border = new Path2D();

                path.rect(x, y, colorSize, colorSize);
                paths.push(path);
                border.rect(x + dbsize, y + dbsize, colorSize - bsize, colorSize - bsize);

                effects.push(
                  effect(() => {
                    const a = computed(() => this.indexA === i);
                    const b = computed(() => this.indexB === i);
                    const c = computed(() => this.data[i].value.toHex(true));

                    return effect(() => {
                      const selectA = a.value;
                      const selectB = b.value;
                      const selectAny = selectA || selectB;

                      this.grid.toFill(ctx);
                      ctx.fill(path);
                      ctx.fillStyle = c.value;
                      ctx.fill(path);
                      ctx.lineWidth = selectAny ? bsize : 1;
                      ctx.strokeStyle = selectAny ? '#fff' : '#000';
                      ctx.stroke(selectAny ? border : path);
                      ctx.strokeStyle = '#000';
                      ctx.stroke(path);

                      if (selectA) {
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(x, y, colorSize / 4, colorSize / 4);
                      }

                      if (selectB) {
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(
                          x + colorSize - scolorSize,
                          y + colorSize - scolorSize,
                          scolorSize,
                          scolorSize
                        );
                      }
                    });
                  })
                );
              }

              effects.push(
                effect(() => {
                  const { x, y } = this.mouse;
                  const index = this.mouseIndex = paths.findIndex(path => {
                    return ctx.isPointInPath(path, x, y);
                  });
                  can.style.cursor = index === -1 ? 'default' : 'pointer';
                })
              );

              ctx.fillStyle = '#000';
              ctx.fillRect(width - 10, 0, 10, height);

              if (this.maxScroll > 0) {
                const handleHeight = Math.max(20, height * (height / (height + maxScroll)));
                const handleY = (this.scroll / maxScroll) * (height - handleHeight);

                ctx.fillStyle = '#fff';
                ctx.fillRect(width - 10, handleY, 10, handleHeight);

                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.strokeRect(width - 10, handleY, 10, handleHeight);
              }

              return dispose(...effects);
            }}
          />
        </Panel>
      </InfoView.Item>
    );
  }
}