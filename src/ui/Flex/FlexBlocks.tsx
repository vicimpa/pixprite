import styled from "styled-components";

export type ResizerProps = {
  $column?: boolean;
  $start?: boolean;
  $size?: number;
};

export const Resizer = styled.div<ResizerProps>`
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