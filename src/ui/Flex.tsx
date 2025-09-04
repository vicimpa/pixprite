import { Component, type PropsWithChildren, type ReactNode } from "react";
import styled from "styled-components";

type FlexItemProps = {
  $column?: boolean;
  $reverse?: boolean;
  $size?: true | number;
  $gap?: number;
  $inline?: boolean;
};

const FlexItem = styled.div<FlexItemProps>`
  display: ${p => p.$inline ? 'inline-' : ''}flex;
  position: relative;
  flex-direction: ${p => (p.$column ? 'column' : 'row') + (p.$reverse ? '-reverse' : '')};
  ${p => p.$size === true ? 'flex-grow: 1;' : ''};
  ${p => typeof p.$size === 'number' ? `flex-basis: ${p.$size}px;` : ''};
  gap: ${p => p.$gap ?? 4}px;
`;

export type FlexProps = {
  column?: boolean;
  reverse?: boolean;
  gap?: number;
  size?: true | number;
  resize?: boolean;
  inline?: boolean;
} & PropsWithChildren;

export class Flex extends Component<FlexProps> {

  render(): ReactNode {
    const { column, reverse, resize, gap, size, children, inline } = this.props;

    if (typeof size === 'boolean' && resize)
      throw new Error('Can not resize with size boolean');

    return (
      <FlexItem $column={column} $reverse={reverse} $gap={gap} $size={size} $inline={inline}>
        {children}
      </FlexItem>
    );
  }
}