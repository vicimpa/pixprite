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

export type PickerHslProps = {
  onChange?: (color: Color, alt: boolean) => any;
};

@reactive()
export class PickerHsl extends Reactive<PickerHslProps> {
  color = Color.fromHsl(180, .5, .5, .5);

  hlRef = signalRef<Slider>();
  satRef = signalRef<Slider>();
  alphaRef = signalRef<Slider>();

  @prop get drag() {
    const { value: hl } = this.hlRef;
    const { value: sat } = this.satRef;
    const { value: alpha } = this.alphaRef;
    return (hl?.drag || sat?.drag || alpha?.drag);
  }

  @prop get hlGradient() {
    const { x: s } = this.satRef.value ?? vec2();
    return ({
      a: [0, s, 0, 1],
      b: [1, s, 0, 1],
      c: [0, s, 1, 1],
      d: [1, s, 1, 1],
    });
  }

  @prop get satGradient() {
    const { x: h, y: l } = this.hlRef.value ?? vec2();
    return ({
      ac: [h, 0, l, 1],
      bd: [h, 1, l, 1],
    });
  }

  @prop get alphaGradient() {
    const { x: h, y: l } = this.hlRef.value ?? vec2();
    const { x: s } = this.satRef.value ?? vec2();
    return ({
      ac: [h, s, l, 0],
      bd: [h, s, l, 1],
    });
  }

  setColor(color: Color) {
    this.color.setFromHsl(...color.hsla);
    var [h, s, l, a] = this.color.hsla;
    h /= 360;
    if (this.drag) return;
    untracked(() => {
      const { value: hl } = this.hlRef;
      const { value: sat } = this.satRef;
      const { value: alpha } = this.alphaRef;

      if (hl) {
        hl.x = h;
        hl.y = l;
      }

      if (sat) {
        sat.x = s;
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
            {/* HL Slider */}
            <Gradient inset hsl gradient={real(this, 'hlGradient')} />
            <Slider ref={this.hlRef} flipY onChange={({ x, y }, alt) => {
              const [, s, , a] = this.color.hsla;
              this.color.setFromHsl(x * 360, s, y, a);
              this.emitChange(alt);
            }} />
          </Panel>
        </Flex>
        <Flex $basis={32} $shrink={0}>
          <Panel>
            {/* Sat Slider */}
            <Gradient inset hsl gradient={real(this, 'satGradient')} />
            <Slider ref={this.satRef} freezeY onChange={({ x }, alt) => {
              const [h, , l, a] = this.color.hsla;
              this.color.setFromHsl(h, x, l, a);
              this.emitChange(alt);
            }} />
          </Panel>
        </Flex>
        <Flex $basis={32} $shrink={0}>
          <Panel>
            {/* Alpha Slider */}
            <Grid inset />
            <Gradient inset hsl gradient={real(this, 'alphaGradient')} />
            <Slider ref={this.alphaRef} freezeY onChange={({ x }, alt) => {
              const [h, s, l] = this.color.hsla;
              this.color.setFromHsl(h, s, l, x);
              this.emitChange(alt);
            }} />
          </Panel>
        </Flex>
      </>
    );
  }
};