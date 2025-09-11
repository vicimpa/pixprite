import styled from "styled-components";

export type ResizerProps = {
  $column: boolean;
  $reverse: boolean;
  $start: boolean;
};

export const Resizer = styled.div<ResizerProps>`
  position: absolute;
  z-index: 1;
  --r-size: calc(var(--gap) * 2);
  --p-size: calc(-1.5 * var(--gap));
  --g-size: calc(var(--gap) - 1px);
  --t-size: 30%;

  &::after {
    position: absolute;
    content: ' ';
    display: block;
    inset: var(--g-size);
    background-color: var(--b2);
    transform: scale(0);
    transition: 0.2s;
  }

  &:hover::after, &[data-drag=true]::after {
    transform: scale(1);
  }

  ${p => p.$column ? `
    left: 0;
    right: 0;
    height: var(--r-size);
    cursor: row-resize;
    ${p.$start !== p.$reverse ? 'top' : 'bottom'}: var(--p-size);

    &::after {
      left: var(--t-size);
      right: var(--t-size);
    }
  ` : `
    top: 0;
    bottom: 0;
    width: var(--r-size);
    cursor: col-resize;
    ${p.$start !== p.$reverse ? 'left' : 'right'}: var(--p-size);

    &::after {
      top: var(--t-size);
      bottom: var(--t-size);
    }
  `}
`; 