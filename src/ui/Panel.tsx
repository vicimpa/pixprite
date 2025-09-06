import styled from "styled-components";

export const Panel = styled.div<{ $width?: number | string, $height?: number | string; }>`
  width: ${p => p.$width ?? 'auto'};
  height: ${p => p.$height ?? 'auto'};
  background-color: #131313;
  border: 4px solid #353535;
  box-shadow: 
    inset -4px 0 0 #000,
    inset 4px 0 0 #000,
    inset 0 -4px 0 #000,
    inset 0 4px 0 #000;
  padding: 4px;
`;