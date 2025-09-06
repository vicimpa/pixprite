import { signalRef } from "$utils/signal";
import { prop, reactive } from "@vicimpa/decorators";
import { Component, type PropsWithChildren, type ReactNode } from "react";
import styled from "styled-components";
import detectResize from "./plugins/detectResize";
import { connect } from "@vicimpa/react-decorators";
import { Resizer } from "./FlexBlocks";
import { computed } from "@preact/signals-react";


type FlexItemProps = {
  $column?: boolean;
  $reverse?: boolean;
  $size?: true | number;
  $gap?: number;
  $content?: string;
  $items?: string;
};

const FlexItem = styled.div<FlexItemProps>`
  position: relative;
  display: flex;
  flex-direction: ${p => (p.$column ? 'column' : 'row') + (p.$reverse ? '-reverse' : '')};
  ${p => p.$size === true ? 'flex-grow: 1;' : ''};
  ${p => typeof p.$size === 'number' ? `flex-basis: ${p.$size}px;` : ''};
  gap: ${p => p.$gap ?? 4}px;
  ${p => p.$content ? `justify-content: ${p.$content}` : ''};
  ${p => p.$items ? `align-items: ${p.$items}` : ''};
  max-width: 100%;
  max-height: 100%;
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
} & PropsWithChildren;

@reactive()
@connect(detectResize)
export class Flex extends Component<FlexProps> {
  ref = signalRef<HTMLDivElement>();
  resizer = signalRef<HTMLDivElement>();

  @prop resizable = this.props.resize ?? false;
  @prop direction = '';
  @prop size = 8;

  componentDidUpdate(prevProps: Readonly<FlexProps>): void {
    this.resizable = prevProps.resize ?? false;
  }

  render(): ReactNode {
    const { column, reverse, gap, size, children, content, items, start } = this.props;

    return (
      <FlexItem
        ref={this.ref}
        $column={column}
        $reverse={reverse}
        $gap={gap}
        $size={size}
        $content={content}
        $items={items}
      >
        {children}
        {computed(() => (
          this.direction && (
            <Resizer
              ref={this.resizer}
              $column={this.direction === 'column'}
              $start={start}
              $size={this.size} />
          )
        ))}
      </FlexItem>
    );
  }
}