import styled from "styled-components";

export const Slider = styled.div`
  position: absolute;
  inset: 0;
  cursor: pointer;
`;


export type PointProps = {
  $freezeX?: true;
  $freezeY?: true;
  $line?: true;
};

export const Point = styled.div<PointProps>`
  position: absolute;
  inset: 0;
  margin: auto;
  width: ${p => p.$freezeX && p.$line ? '100%' : '8px'};
  height: ${p => p.$freezeY && p.$line ? '100%' : '8px'};
  border: 2px solid var(--point-color, #fff);
  pointer-events: none;
  box-shadow: 
    -1px 0 0 #000, 
    1px 0 0 #000, 
    0 -1px 0 #000, 
    0 1px 0 #000, 
    inset -1px 0 0 #000, 
    inset 1px 0 0 #000, 
    inset 0 -1px 0 #000, 
    inset 0 1px 0 #000;

  transform: translateX(var(--x, 0px)) translateY(var(--y, 0px));
`;