import { Component } from "react";
import { PointSlider } from "../PointSlider/PointSlider";
import { prop, reactive } from "@vicimpa/decorators";
import { CSSVariables } from "../CSSVariables";
import { GridView } from "$ui/GridView";
import { batch, untracked } from "@preact/signals-react";
import { signalRef } from "$utils/signal";
import { Color } from "$core/Color";
import { vec2 } from "@vicimpa/glm";
import { Gradient, HLBlock, SVBlock } from "./ColorBlocks";
import { getColorInfo } from "./ColorInfo";
import { Panel } from "$ui/Panel";
import { Flex } from "$ui/Flex";

export type ColorPickerProps = {
  isHSL?: boolean;
  onChange?: (color: Color, alt: boolean) => any;
};

@reactive()
export class ColorPicker extends Component<ColorPickerProps> {
  @prop h = 0;
  @prop s = 0;
  @prop vl = 0;
  @prop a = 1;

  @prop get drag() {
    const block = this.blockRef.current;
    const sv = this.svRef.current;
    const alpha = this.alphaRef.current;
    return Boolean(block?.drag || sv?.drag || alpha?.drag);
  }

  @prop get color() {
    if (this.props.isHSL)
      return new Color().fromHsl(this.h, this.s, this.vl, this.a);

    return new Color().fromHsv(this.h, this.s, this.vl, this.a);
  }

  blockRef = signalRef<PointSlider>();
  svRef = signalRef<PointSlider>();
  alphaRef = signalRef<PointSlider>();

  getVariables() {
    const hsv = this.color.toHsv();
    const hsl = this.color.toHsl();
    return {
      h: this.h + 'deg',
      s: this.s * 100 + '%',
      v: hsv.v * 100 + '%',
      l: hsl.l * 100 + '%'
    };
  }

  fromColor(color: Color) {
    if (untracked(() => this.drag))
      return;

    if (this.props.isHSL) {
      const hsl = color.toHsl();

      return batch(() => {
        this.h = hsl.h;
        this.s = hsl.s;
        this.vl = hsl.l;
        this.a = hsl.a;

        this.blockRef.current?.set(vec2(hsl.h / 360, 1 - hsl.l), true);
        this.svRef.current?.set(vec2(hsl.s), true);
        this.alphaRef.current?.set(vec2(hsl.a), true);
      });
    }

    const hsv = color.toHsv();

    batch(() => {
      this.h = hsv.h;
      this.s = hsv.s;
      this.vl = hsv.v;
      this.a = hsv.a;

      this.blockRef.current?.set(vec2(hsv.s, 1 - hsv.v), true);
      this.svRef.current?.set(vec2(hsv.h / 360), true);
      this.alphaRef.current?.set(vec2(hsv.a), true);
    });
  }

  render() {
    const { isHSL } = this.props;

    return (
      <>
        <CSSVariables calc={() => this.getVariables()}>
          <Panel>
            <Flex column>
              <PointSlider
                ref={this.blockRef}
                info={({ current: { x, y } }) => {
                  if (isHSL) {
                    return getColorInfo(x * 360, this.s, 1 - y, undefined, true);
                  }

                  return getColorInfo(this.h, x, 1 - y);
                }}
                onChange={({ x, y }, alt) => {
                  batch(() => {
                    if (isHSL) {
                      this.h = x * 360;
                    } else {
                      this.s = x;
                    }
                    this.vl = 1 - y;
                    this.props.onChange?.(this.color.clone(), alt);
                  });
                }}
              >
                {isHSL ? <HLBlock /> : <SVBlock />}
              </PointSlider>
              <PointSlider
                ref={this.svRef}
                freezeY
                info={({ current: { x } }) => {
                  if (isHSL)
                    return getColorInfo(this.h, x, this.vl, undefined, true);

                  return getColorInfo(x * 360, this.s, this.vl);
                }}
                onChange={({ x }, alt) => {
                  if (isHSL) {
                    this.s = x;
                  } else {
                    this.h = x * 360;
                  }
                  this.props.onChange?.(this.color.clone(), alt);
                }}
              >
                {isHSL ? (
                  <Gradient
                    $from="hsl(var(--h), 0%, var(--l))"
                    $to="hsl(var(--h), 100%, var(--l))"
                    $param="in hsl" />
                ) : (
                  <Gradient
                    $from="hsl(0, 100%, 50%)"
                    $to="hsl(360, 100%, 50%)"
                    $param="in hsl longer hue" />
                )}
              </PointSlider>
              <PointSlider
                ref={this.alphaRef}
                freezeY
                info={({ current: { x } }) => {
                  return getColorInfo(this.h, this.s, this.vl, x, isHSL);
                }}
                onChange={({ x: a }, alt) => {
                  this.a = a;
                  this.props.onChange?.(this.color.clone(), alt);
                }}
              >
                <GridView $size={13}>
                  <Gradient
                    $from="hsla(var(--h), var(--s), var(--l), 0)"
                    $to="hsla(var(--h), var(--s), var(--l), 1)" />
                </GridView>
              </PointSlider>

            </Flex>
          </Panel>
        </CSSVariables>
      </>
    );
  }
}