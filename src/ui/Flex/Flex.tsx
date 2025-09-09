import { signalRef } from "$utils/signal";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Component, type PropsWithChildren, type ReactNode, type Ref } from "react";
import { computed } from "@preact/signals-react";

import detectResize from "./plugins/detectResize";
import { connect, inject, provide } from "@vicimpa/react-decorators";
import styled from "styled-components";

const DEFAULT_GAP = 4;

export type FlexItemProps = {
  $column?: boolean;
  $reverse?: boolean;
  $size?: true | number;
  $gap?: number;
  $content?: string;
  $items?: string;
  $wrap?: boolean | string;
  $inset?: boolean;
};

export const FlexItem = styled.div<FlexItemProps>`
  position: ${p => p.$inset ? 'absolute' : 'relative'};
  ${p => p.$inset ? 'inset: 0;' : ''}
  display: flex;
  flex-direction: ${p => (p.$column ? 'column' : 'row') + (p.$reverse ? '-reverse' : '')};
  ${p => p.$size === true ? 'flex-grow: 1;' : ''};
  ${p => typeof p.$size === 'number' ? `flex-basis: ${p.$size}px;` : ''};
  gap: ${p => p.$gap ?? DEFAULT_GAP}px;
  ${p => p.$content ? `justify-content: ${p.$content}` : ''};
  ${p => p.$items ? `align-items: ${p.$items}` : ''};
  flex-wrap: ${p => p.$wrap ? (p.$wrap === true ? 'wrap' : p.$wrap) : ''};
  max-width: 100%;
  max-height: 100%;
  ${p => p.$inset ? 'overflow: hidden;' : ''}
`;

export type FlexProps = {
  column?: boolean;
  reverse?: boolean;
  gap?: number;
  size?: true | number;
  resize?: boolean;
  content?: string;
  items?: string;
  start?: boolean;
  wrap?: boolean | 'string';
  inset?: boolean;
} & PropsWithChildren;

@provide()
@reactive()
@connect(detectResize)
export class Flex extends Component<FlexProps> {
  ref = signalRef<HTMLDivElement>();
  resizer = signalRef<HTMLDivElement>();

  @prop @inject(() => Flex, false) parent?: Flex;

  @prop gap = this.props.gap ?? DEFAULT_GAP;
  @prop start = this.props.start ?? false;
  @prop column = this.props.column ?? false;
  @prop reverse = this.props.reverse ?? false;
  @prop resizable = this.props.resize ?? false;
  @prop size = 8;

  get parentGap() {
    return this.parent?.gap ?? DEFAULT_GAP;
  }

  get reversed() {
    return this.start !== (this.parent?.reverse ?? false);
  }

  componentDidUpdate(): void {
    this.gap = this.props.gap ?? DEFAULT_GAP;
    this.start = this.props.start ?? false;
    this.column = this.props.column ?? false;
    this.resizable = this.props.resize ?? false;
    this.reverse = this.props.reverse ?? false;
  }

  resizerView = computed(() => {
    if (!this.resizable)
      return null;

    return (
      <Resizer
        ref={this.resizer}
        $column={this.parent?.column}
        $start={this.reversed}
        $size={this.parentGap}
      />
    );
  });

  render(): ReactNode {
    const { column, reverse, gap, size, children, content, items, wrap, inset } = this.props;

    return (
      <FlexItem
        ref={this.ref}
        $column={column}
        $reverse={reverse}
        $gap={gap}
        $size={size}
        $content={content}
        $items={items}
        $wrap={wrap}
        $inset={inset}
      >
        {children}
        {this.resizerView}
      </FlexItem>
    );
  }
}

type ResizerProps = {
  $column?: boolean;
  $start?: boolean;
  $size?: number;
};

const Resizer = styled.div<ResizerProps>`
  position: absolute;
  ${p => p.$column ? (`
    left: 0;
    right: 0;
    height: ${p.$size ?? 8}px;
    cursor: row-resize;
    ${p.$start ? `top: ${-(p.$size ?? 8)}px;` : `bottom: ${-(p.$size ?? 8)}px;`}
  `) : (`
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    ${p.$start ? `left: ${-(p.$size ?? 8)}px;` : `right: ${-(p.$size ?? 8)}px;`}
  `)}
`;