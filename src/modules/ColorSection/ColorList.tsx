import { Component } from "react";
import { prop, reactive } from "@vicimpa/decorators";
import { Color } from "$core/Color";
import { array, dispose } from "$utils/misc";
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
import styled from "styled-components";

const DEFAULT_PALETTE = await paletteCollection[0].fetch();

export const SIZES = [
  [24, 'Маленький'],
  [32, 'Средний'],
  [48, 'Большой']
] as const;

export type ColorListProps = {
  editable?: boolean;
  onChange?: (color: Color, alt: boolean) => any;
};

const StyledCanvas = styled(Canvas)`
  image-rendering: pixelated;
  pointer-events: none;
  cursor: pointer;
`;

const Scrolling = styled.div`
  position: absolute;
  inset: 0;
  overflow-y: scroll;
`;

@connect(detectUnselect, detectResize)
@reactive()
export class ColorList extends Component<ColorListProps> {
  ref = signalRef<HTMLDivElement>();

  grid = new Grid(8);

  @prop mouse = vec2(-Infinity);
  @prop mouseIndex = -1;

  @prop data = array(1024, (i) => signal(DEFAULT_PALETTE[i]?.clone() ?? new Color()));
  @prop size = DEFAULT_PALETTE.length;
  @prop colorSize = +SIZES[0][0];
  @prop padding = 4;

  @prop indexA?: number;
  @prop indexB?: number;

  @prop width = 0;
  @prop get height() {
    const { length, rowSize, colorSize, padding } = this;
    return Math.ceil(length / rowSize) * (colorSize + padding);
  }

  @prop get length() {
    return Math.min(this.data.length, this.size);
  }
  @prop get rowSize() {
    const { colorSize, padding } = this, width = this.width;
    return (width - padding) / (colorSize + padding) | 0;
  }

  getPosition(i: number) {
    const { rowSize, colorSize, padding } = this;
    const x = ((i % rowSize | 0) * (colorSize + padding)) + padding;
    const y = ((i / rowSize | 0) * (colorSize + padding)) + padding;
    return vec2(x, y);
  }

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

  showIndex(index: number) {
    const tags = ['none'];
    return tags[index + 1] ?? index;
  }

  colorInfo = computed(() => (
    this.mouseIndex === -1 ? null : (
      <ColorInfo
        color={this.data[this.mouseIndex]!.value}
        prefix={`Index ${this.mouseIndex}`} />
    )
  ));

  render() {
    return (
      <Panel
        ref={this.ref}
        className="grow-1 relative"
      >
        <Scrolling>
          <div
            onMouseMove={({ nativeEvent: e }) => {
              this.mouse = vec2(e.offsetX, e.offsetY);
            }}
            onMouseDown={({ nativeEvent: e, button }) => {
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
          >
            <InfoView.Item info={this.colorInfo}>
              <StyledCanvas
                draw={(can, ctx) => {
                  const {
                    grid,
                    colorSize,
                    length,
                    padding,
                    width,
                    height,
                  } = this;

                  grid.size = colorSize / 2;

                  can.width = width;
                  can.height = height;
                  ctx.clearRect(0, 0, width, height);

                  const paths: { path: Path2D, index: number; }[] = [];
                  const tColorSize = colorSize / 2.5;

                  for (let i = 0; i < length; i++) {
                    const { x, y } = this.getPosition(i);

                    const fill = new Path2D();
                    fill.rect(x, y, colorSize, colorSize);

                    const path = new Path2D();
                    path.rect(x - padding, y - padding, colorSize + padding * 2, colorSize + padding * 2);
                    paths.push({ path, index: i });

                    const selectA = this.indexA === i;
                    const selectB = this.indexB === i;
                    const selectAny = selectA || selectB;
                    const { value: color } = this.data[i];
                    const { l } = color.toHsl();
                    const accent = l >= .5 ? '#000' : '#fff';

                    grid.setFill(ctx);
                    ctx.fill(fill);
                    ctx.fillStyle = color.toHex(true);
                    ctx.fill(fill);
                    if (selectAny) {
                      ctx.strokeStyle = '#fff';
                      ctx.fillStyle = accent;
                      ctx.lineWidth = colorSize / 8;
                      ctx.globalCompositeOperation = 'difference';
                      ctx.stroke(fill);
                      ctx.globalCompositeOperation = 'source-over';

                      ctx.beginPath();

                      if (selectA) {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + tColorSize, y);
                        ctx.lineTo(x, y + tColorSize);
                        ctx.lineTo(x, y);
                      }

                      if (selectB) {
                        ctx.moveTo(x + colorSize, y + colorSize);
                        ctx.lineTo(x + colorSize - tColorSize, y + colorSize);
                        ctx.lineTo(x + colorSize, y + colorSize - tColorSize);
                        ctx.lineTo(x + colorSize, y + colorSize);
                      }

                      ctx.fill();
                      ctx.closePath();
                    }
                  }

                  return dispose(
                    effect(() => {
                      const { x, y } = this.mouse;
                      const find = paths.find(({ path }) => (
                        ctx.isPointInPath(path, x, y)
                      ));

                      this.mouseIndex = find?.index ?? -1;
                      can.style.pointerEvents = find ? 'all' : 'none';
                    })
                  );
                }}
              />
            </InfoView.Item>
          </div>
        </Scrolling>
      </Panel>
    );
  }
}