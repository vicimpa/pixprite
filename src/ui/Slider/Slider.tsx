import * as styled from "./styled";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Vec2, vec2 } from "@vicimpa/glm";
import { signalRef } from "$utils/signals";
import { Variables } from "$ui/Variables";
import { connect } from "@vicimpa/react-decorators";
import detectResize from "./plugins/detectResize";
import { mouseOffset } from "$utils/mouse";
import detectDrag from "./plugins/detectDrag";
import detectInput from "./plugins/detectInput";
import { Reactive } from "$core/Reactive";
import { batch } from "@preact/signals-react";

export type SliderProps = {
  color?: string | (() => string);
  freezeX?: true;
  freezeY?: true;
  flipX?: true;
  flipY?: true;
  line?: true;
  onChange?: (pos: Vec2, alt: boolean) => any;
};

@reactive()
@connect(detectResize, detectDrag, detectInput)
export class Slider extends Reactive<SliderProps> {
  ref = signalRef<HTMLDivElement>();
  mouse = mouseOffset(this.ref, true, true);

  @prop drag = false;
  @prop alt = false;

  @prop get color() { return this.$props.color ?? '#fff'; };
  @prop get freezeX() { return this.$props.freezeX ?? false; };
  @prop get freezeY() { return this.$props.freezeY ?? false; };
  @prop get flipX() { return this.$props.flipX ?? false; }
  @prop get flipY() { return this.$props.flipY ?? false; }

  @prop x = .5;
  @prop y = .5;

  @prop size = vec2();

  @prop get viewX() { return this.freezeX ? .5 : this.x; }
  @prop get viewY() { return this.freezeY ? .5 : this.y; }

  @prop get realX() { return (this.viewX * 2 - 1) * (this.size.x / 2) * (this.flipX ? -1 : 1) + 'px'; }
  @prop get realY() { return (this.viewY * 2 - 1) * (this.size.y / 2) * (this.flipY ? -1 : 1) + 'px'; }

  @prop get finalColor() { return this.color instanceof Function ? this.color() : this.color; }

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
        <Variables color={real(this, 'finalColor')} x={real(this, 'realX')} y={real(this, 'realY')}>
          <styled.Point $line={this.props.line} $freezeX={this.props.freezeX} $freezeY={this.props.freezeY} />
        </Variables>
      </styled.Slider>
    );
  }
}