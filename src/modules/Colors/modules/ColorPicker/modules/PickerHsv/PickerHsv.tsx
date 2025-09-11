import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Grid } from "$ui/Grid";
import { Panel } from "$ui/Panel";
import { Slider } from "$ui/Slider";
import { signalRef } from "$utils/signals";
import { Gradient } from "$ui/Gradient/Gradient";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Reactive } from "$core/Reactive";
import { vec2 } from "@vicimpa/glm";
import { untracked } from "@preact/signals-react";

export type PickerHsvProps = {
  onChange?: (color: Color, alt: boolean) => any;
};

@reactive()
export class PickerHsv extends Reactive<PickerHsvProps> {
  color = Color.fromHsv(180, .5, .5);

  svRef = signalRef<Slider>();
  hueRef = signalRef<Slider>();
  alphaRef = signalRef<Slider>();

  @prop get drag() {
    const { value: sv } = this.svRef;
    const { value: hue } = this.hueRef;
    const { value: alpha } = this.alphaRef;
    return (sv?.drag || hue?.drag || alpha?.drag);
  }

  @prop get svGradient() {
    var { x: h } = this.hueRef.value ?? vec2();
    return ({
      a: [h, 0, 0, 1],
      b: [h, 1, 0, 1],
      c: [h, 0, 1, 1],
      d: [h, 1, 1, 1],
    });
  }

  @prop get hueGradient() {
    return ({
      ac: [0, 1, 1, 1],
      bd: [1, 1, 1, 1],
    });
  }

  @prop get alphaGradient() {
    var { x: s, y: v } = this.svRef.value ?? vec2();
    var { x: h } = this.hueRef.value ?? vec2();

    return ({
      ac: [h, s, v, 0],
      bd: [h, s, v, 1],
    });
  }

  setColor(color: Color) {
    this.color.setFromHsv(...color.hsva);
    var [h, s, v, a] = this.color.hsva;
    h /= 360;
    if (this.drag) return;
    untracked(() => {
      const { value: sv } = this.svRef;
      const { value: hue } = this.hueRef;
      const { value: alpha } = this.alphaRef;

      if (sv) {
        sv.x = s;
        sv.y = v;
      }

      if (hue) {
        hue.x = h;
      }

      if (alpha) {
        alpha.x = a;
      }
    });
  }

  emitChange(alt: boolean) {
    this.props.onChange?.(this.color.clone(), alt);
  }

  render() {
    return (
      <>
        <Flex $grow>
          <Panel>
            {/* SV Slider */}
            <Gradient
              inset
              gradient={real(this, 'svGradient')} />
            <Slider
              ref={this.svRef}
              flipY
              onChange={({ x, y }, alt) => {
                const [h, , , a] = this.color.hsva;
                this.color.setFromHsv(h, x, y, a);
                this.emitChange(alt);
              }} />
          </Panel>
        </Flex>
        <Flex $basis={32} $shrink={0}>
          <Panel>
            {/* Hue Slider */}
            <Gradient
              inset
              gradient={real(this, 'hueGradient')} />
            <Slider
              ref={this.hueRef}
              freezeY
              onChange={({ x }, alt) => {
                const [, s, v, a] = this.color.hsva;
                this.color.setFromHsv(x * 360, s, v, a);
                this.emitChange(alt);
              }} />
          </Panel>
        </Flex>
        <Flex $basis={32} $shrink={0}>
          <Panel>
            {/* Alpha Slider */}
            <Grid inset />
            <Gradient
              inset
              gradient={real(this, 'alphaGradient')} />
            <Slider
              ref={this.alphaRef}
              freezeY
              onChange={({ x }, alt) => {
                const [h, s, v] = this.color.hsva;
                this.color.setFromHsv(h, s, v, x);
                this.emitChange(alt);
              }} />
          </Panel>
        </Flex>
      </>
    );
  }
};