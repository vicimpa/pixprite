import styled from "styled-components";

export const Panel = styled.div`
  position: absolute;
  inset: 0px;
  background-color: #000;
  border: 2px solid var(--b1);
  box-shadow: inset 0 0 4px #000;
`;

export const PanelContent = styled.div`
  position: absolute;
  inset: 2px;
  border: none;
  background-color: var(--bg2);
`;