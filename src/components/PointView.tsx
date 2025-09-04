import { prop, reactive } from "@vicimpa/decorators";
import { Vec2, vec2 } from "@vicimpa/glm";
import { connect } from "@vicimpa/react-decorators";
import { Component, type PropsWithChildren, type ReactNode } from "react";
import { dispose } from "../utils/misc";
import { signalRef } from "../utils/signal";
import { batch, computed, effect, untracked } from "@preact/signals-react";
import { elementEvents, windowEvents } from "@vicimpa/events";
import { InfoView } from "./InfoView";
import { getMouseVec } from "../utils/mouse";
import { resizeObserver } from "@vicimpa/observers";
import rsp from "@vicimpa/rsp";


export type PointViewProps = {
  freezeX?: boolean;
  freezeY?: boolean;
  info?: (self: PointView) => ReactNode;
  onChange?: (current: Vec2, alt: boolean) => any;
} & PropsWithChildren;

@connect((self) => (
  dispose(
    effect(() => {
      const { value: ref } = self.ref;
      if (!ref) return;

      return dispose(
        elementEvents(ref, 'mousedown', (e) => {
          batch(() => {
            self.drag = e.button !== 1;
            self.alt = e.button === 2;
            self.update(getMouseVec(e, ref, true, true));
          });
        }),
        windowEvents('mousemove', (e) => {
          self.update(getMouseVec(e, ref, true, true));
        }),
        windowEvents(['mouseup', 'blur'], () => {
          batch(() => {
            self.drag = false;
            self.alt = false;
          });
        })
      );
    }),
    effect(() => {
      if (self.drag)
        self.move(self.current);
    }),
    effect(() => {
      if (!self.drag)
        return;
      const { current, alt } = self;

      untracked(() => {
        self.props.onChange?.(current, alt);
      });
    }),
    effect(() => (
      resizeObserver(self.ref.value, ({ contentRect: { width, height } }) => {
        self.size = self.size.set(width, height).clone();
      })
    ))
  )
))
@reactive()
export class PointView extends Component<PointViewProps> {
  ref = signalRef<HTMLDivElement>();

  @prop drag = false;
  @prop alt = false;
  @prop current = vec2();
  @prop size = vec2();
  @prop translate = vec2(.5);


  style = computed(() => {
    const { x, y } = this.translate
      .clone()
      .add(-.5)
      .mul(this.size);

    return {
      transform: `matrix(1, 0, 0, 1, ${x}, ${y})`
    };
  });

  info = computed(() => {
    return this.props.info?.(this) ?? null;
  });

  move(current: Vec2) {
    this.translate = current.clone();
  }

  update(current: Vec2, move = false) {
    if (this.props.freezeX)
      current.x = .5;

    if (this.props.freezeY)
      current.y = .5;

    this.current = current;

    if (move)
      this.move(current);
  }

  set(current: Vec2, move = false) {
    if (this.drag)
      return;

    this.update(current, move);
  }

  render() {
    return (
      <InfoView.Item info={this.info}>
        <div className="w-auto h-auto relative cursor-default">
          {this.props.children}
          <div ref={this.ref} className="flex justify-center items-center w-full h-full inset-0 absolute">
            <rsp.div style={this.style} className="w-1 h-1 border-1 border-white pointer-events-none mix-blend-difference" />
          </div>
        </div>
      </InfoView.Item>
    );
  }
}