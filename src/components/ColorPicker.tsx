import { Component } from "react";
import { PointView } from "./PointView";
import { prop, reactive } from "@vicimpa/decorators";
import styled from "styled-components";
import { CSSVariables } from "./CSSVariables";
import { GridView } from "./GridView";
import { batch, untracked } from "@preact/signals-react";
import { signalRef } from "../utils/signal";
import { Color } from "../core/Color";
import { vec2 } from "@vicimpa/glm";
import { ColorInfo } from "./ColorInfo";

const HLBlock = styled.div`
  background: 
    linear-gradient(
      to right in hsl longer hue,
      hsl(0, var(--s), 50%) 0%,
      hsl(360, var(--s), 50%) 100%
    ),
    linear-gradient(to top,#000,#fff);
  background-blend-mode: overlay;
`;

const SVBlock = styled.div`
  background: hsl(var(--h), 100%, 50%);
  background:
    linear-gradient(
      to right, 
      hsl(var(--h), 100%, 100%), 
      hsl(var(--h), 100%, 50%)
    ),
    linear-gradient(to top, #000, transparent);
  background-blend-mode: overlay;
`;

const Gradient = styled.div<{ $from: string, $to: string, $param?: string; }>`
  position: relative;
  background: linear-gradient(
    to right ${e => e.$param ?? ''},
    ${e => e.$from},
    ${e => e.$to}
  );
`;

export const getColorInfo = (h: number, s: number, vl: number, a?: number, isHSL = false) => {
  const color = new Color();

  if (isHSL) {
    color.fromHsl(h, s, vl, a ?? 1);
  } else {
    color.fromHsv(h, s, vl, a);
  }

  return <ColorInfo color={color} {...{ h, s, vl, a, isHSL }} />;
};

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

  blockRef = signalRef<PointView>();
  svRef = signalRef<PointView>();
  alphaRef = signalRef<PointView>();

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
    return (
      <div className="flex flex-col gap-0.5">
        <CSSVariables calc={() => this.getVariables()}>
          <div className="border-1 border-gray-500">

            <PointView
              ref={this.blockRef}
              info={({ current: { x, y } }) => {
                if (this.props.isHSL) {
                  return getColorInfo(x * 360, this.s, 1 - y, undefined, true);
                }

                return getColorInfo(this.h, x, 1 - y);
              }}
              onChange={({ x, y }, alt) => {
                batch(() => {
                  if (this.props.isHSL) {
                    this.h = x * 360;
                  } else {
                    this.s = x;
                  }
                  this.vl = 1 - y;
                  this.props.onChange?.(this.color.clone(), alt);
                });
              }}
            >
              {this.props.isHSL ? (
                <HLBlock className="h-20" />
              ) : (
                <SVBlock className="h-20" />
              )}
            </PointView>
          </div>
          <div className="border-2 border-gray-500 relative">
            <PointView
              ref={this.svRef}
              freezeY
              info={({ current: { x } }) => {
                if (this.props.isHSL) {
                  return getColorInfo(this.h, x, this.vl, undefined, true);
                }

                return getColorInfo(x * 360, this.s, this.vl);
              }}
              onChange={({ x }, alt) => {
                if (this.props.isHSL) {
                  this.s = x;
                } else {
                  this.h = x * 360;
                }
                this.props.onChange?.(this.color.clone(), alt);
              }}
            >
              {this.props.isHSL ? (
                <Gradient
                  $from="hsl(var(--h), 0%, var(--l))"
                  $to="hsl(var(--h), 100%, var(--l))"
                  $param="in hsl"
                  className="h-3" />
              ) : (

                <Gradient
                  $from="hsl(0, 100%, 50%)"
                  $to="hsl(360, 100%, 50%)"
                  $param="in hsl longer hue"
                  className="h-3" />
              )}
            </PointView>
          </div>
          <div className="border-1 border-gray-500">
            <PointView
              ref={this.alphaRef}
              freezeY
              info={({ current: { x } }) => {
                return getColorInfo(this.h, this.s, this.vl, x, this.props.isHSL);
              }}
              onChange={({ x: a }, alt) => {
                this.a = a;
                this.props.onChange?.(this.color.clone(), alt);
              }}
            >
              <GridView $size={13}>
                <Gradient
                  $from="hsla(var(--h), var(--s), var(--l), 0)"
                  $to="hsla(var(--h), var(--s), var(--l), 1)"
                  className="h-3" />
              </GridView>
            </PointView>
          </div>
        </CSSVariables>
      </div>
    );
  }
}