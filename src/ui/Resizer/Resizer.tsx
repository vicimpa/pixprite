import { Component } from "react";
import { reactive, prop } from "@vicimpa/decorators";
import { signalRef, style } from "$utils/signals";
import * as styled from "./styled";
import { computed } from "@preact/signals-react";
import { makeDrag } from "@vicimpa/easy-drag";
import { clamp } from "$utils/math";

export type ResizerProps = {
  start?: true;
};

@reactive()
export class Resizer extends Component<ResizerProps> {
  ref = signalRef<HTMLDivElement>();

  @prop drag = false;
  @prop start = this.props.start ?? false;

  @prop get item() {
    return this.ref.value?.parentElement ?? null;
  }

  @prop get parrent() {
    return this.item?.parentElement ?? null;
  }

  @prop get direction() {
    if (!this.parrent) return null;
    return style(this.parrent, 'flexDirection').value;
  }

  @prop get column() {
    return this.direction?.includes('column') ?? false;
  }

  @prop get reverse() {
    return this.direction?.includes('reverse') ?? false;
  }

  mouseDown = makeDrag(() => {
    const { item, parrent, start, column, reverse } = this;
    const isReversed = start !== reverse;

    if (!item || !parrent) return;
    const basis = column ? item.offsetHeight : item.offsetWidth;
    const maxBasis = column ? parrent.offsetHeight : parrent.offsetWidth;
    this.drag = true;

    return ({ delta }) => {
      const mul = isReversed ? -1 : 1;
      const current = clamp(basis - (column ? delta.y : delta.x) * mul, 0, maxBasis);
      item.style.flexBasis = `${current}px`;

      return () => {
        this.drag = false;
      };
    };
  });

  resizerView = computed(() => (
    this.direction === null ? null :
      <styled.Resizer
        onMouseDown={this.mouseDown}
        $start={this.start}
        $column={this.column}
        $reverse={this.reverse}
        data-drag={this.drag}
      />
  ));

  componentDidUpdate(): void {
    this.start = this.props.start ?? false;
  }

  render() {
    return (
      <div ref={this.ref} className="contents">
        {this.resizerView}
      </div>
    );
  }
}