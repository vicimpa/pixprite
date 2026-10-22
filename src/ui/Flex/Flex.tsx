import type { CSSProperties } from "react";
import styled from "styled-components";
export type FlexDir = CSSProperties['justifyContent'];

export type FlexProps = {
  $column?: boolean;
  $reverse?: boolean;
  $content?: FlexDir;
  $items?: FlexDir;
  $gap?: number;
  $grow?: true | number;
  $padding?: string | number;
  $basis?: number;
  $inline?: boolean;
  $inset?: true | number;
  $shrink?: number;
};

export const Flex = styled.div<FlexProps>`
  display: ${p => p.$inline ? 'inline-' : ''}flex;
  ${p => p.$shrink !== undefined ? `flex-shrink: ${p.$shrink};` : ''}
  flex-direction: ${p => p.$column ? 'column' : 'row'}${p => p.$reverse ? '-reverse' : ''};
  ${p => p.$content ? `justify-content: ${p.$content};` : ''}
  ${p => p.$items ? `align-items: ${p.$items};` : ''}
  gap: ${p => typeof p.$gap === 'number' ? `${p.$gap}px` : 'var(--gap)'};
  ${p => p.$grow ? `flex-grow: ${+p.$grow};` : ''};
  ${p => p.$padding !== undefined ? `padding: ${p.$padding};` : ''};
  ${p => p.$inset !== undefined ? `
    position: absolute;
    inset: ${typeof p.$inset === 'number' ? `${p.$inset}px` : `0`};
    overflow: hidden;
  ` : 'position: relative;'}
  ${p => typeof p.$basis === 'number' ? `flex-basis: ${p.$basis}px;` : ''}
`;
