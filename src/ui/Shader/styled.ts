import styled from "styled-components";

export const Container = styled.div<{ $inset?: true; }>`
  ${p => p.$inset ? `
    position: absolute;
    inset: 0;
  ` : `
    position: relative;
    width: 100%;
    height: 100%;
  `}
`;

export const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
`;