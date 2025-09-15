import * as styled from "./styled";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Vec2, vec2 } from "@vicimpa/glm";
import { signalRef } from "$utils/signals";
import { Variables } from "$ui/Variables";
import { signalSize, signalMouse } from "$utils/observers";
import { Reactive } from "$core/Reactive";
import { batch, effect } from "@preact/signals-react";
import { useEffect } from "$utils/decorators";
import { dispose } from "$utils/common";
import { windowEvents } from "@vicimpa/events";

export type SliderProps = {
  freezeX?: true;
  freezeY?: true;
  flipX?: true;
  flipY?: true;
  line?: true;
  onChange?: (pos: Vec2, alt: boolean) => any;
};

@reactive()
export class Slider extends Reactive<SliderProps> {
  ref = signalRef<HTMLDivElement>();
  #mouse = signalMouse(this.ref, true, true);
  #size = signalSize(this.ref);

  @prop get mouse() { return this.#mouse.value; }
  @prop get size() { return this.#size.value; }
  @prop get flip() { return vec2(-this.flipX, -this.flipY).scale(2).add(1); }
  @prop get real() { return vec2().copy(this).sub(.5).mul(this.size).mul(this.flip); }

  @prop drag = false;
  @prop alt = false;

  @prop get flipX() { return this.$props.flipX ?? false; }
  @prop get flipY() { return this.$props.flipY ?? false; }

  @prop x = .5;
  @prop y = .5;

  @prop get realX() { return this.real.x + 'px'; }
  @prop get realY() { return this.real.y + 'px'; }

  @useEffect()
  updater() {
    return dispose(
      effect(() => {
        const { drag, alt, flipX, flipY, flip, mouse } = this;
        if (!drag) return;

        batch(() => {
          const pos = vec2(
            flipX ? 1 - mouse.x : mouse.x,
            flipY ? 1 - mouse.y : mouse.y
          );
          this.x = pos.x;
          this.y = pos.y;
          this.props.onChange?.(pos, alt);
        });
      }),
      windowEvents(['mouseup', 'blur'], () => {
        this.drag = false;
        this.alt = false;
      })
    );
  }

  render() {
    return (
      <styled.Slider
        ref={this.ref}
        onMouseDown={({ button }) => {
          batch(() => {
            this.drag = button !== 1;
            this.alt = button === 2;
          });
        }}>
        <Variables x={real(this, 'realX')} y={real(this, 'realY')}>
          <styled.Point
            $line={this.props.line}
            $freezeX={this.props.freezeX}
            $freezeY={this.props.freezeY} />
        </Variables>
      </styled.Slider>
    );
  }
}