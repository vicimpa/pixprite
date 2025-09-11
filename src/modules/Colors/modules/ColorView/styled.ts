import { Flex } from "$ui/Flex";
import styled from "styled-components";

export const ColorBox = styled(Flex)`
  flex-basis: 148px;
  height: 32px;
  cursor: pointer;
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
`;

export const ColorView = styled.div`
  position: absolute;
  inset: 0;
  background-color: var(--color);
`;