import { prop, reactive } from "@vicimpa/decorators";
import { Vec2, vec2 } from "@vicimpa/glm";
import { connect } from "@vicimpa/react-decorators";
import { Component, type PropsWithChildren, type ReactNode } from "react";
import { signalRef } from "../../utils/signal";
import { computed } from "@preact/signals-react";

import { InfoView } from "../InfoView";
import rsp from "@vicimpa/rsp";
import detectMove from "./plugins/detectMove";
import detectChange from "./plugins/detectChange";
import detectResize from "./plugins/detectResize";
import { PointBlock, PointContainer, PointView } from "./PointBlocks";

export type PointSliderProps = {
  freezeX?: boolean;
  freezeY?: boolean;
  info?: (self: PointSlider) => ReactNode;
  onChange?: (current: Vec2, alt: boolean) => any;
} & PropsWithChildren;

@connect(detectMove, detectChange, detectResize)
@reactive()
export class PointSlider extends Component<PointSliderProps> {
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
        <PointContainer>
          {this.props.children}
          <PointBlock ref={this.ref}>
            <rsp.$ $target={PointView} style={this.style} />
          </PointBlock>
        </PointContainer>
      </InfoView.Item>
    );
  }
}