import styled from "styled-components";

export const ColorBox = styled.button`
  display: flex;
  position: relative;
  min-width: 0;
  flex: 1 1 148px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
`;

export const ColorText = styled.label`
  font-size: 16px;
  font-weight: 900;
  z-index: 1;
  pointer-events: none;
  color: #fff;
  text-shadow: 
    -1px 0 0 #000,
    1px 0 0 #000,
    0 -1px 0 #000,
    0 1px 0 #000,
    -1px -1px 0 #000,
    1px 1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000;
  text-transform: uppercase;
`;

export const ColorView = styled.div`
  position: absolute;
  inset: 0;
  background-color: var(--color);
`;
