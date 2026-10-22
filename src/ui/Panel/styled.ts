import styled from "styled-components";

export const Panel = styled.div`
  position: absolute;
  inset: 0px;
  background-color: var(--bg2);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--shade);
`;

export const PanelContent = styled.div`
  position: absolute;
  inset: 1px;
  border: none;
  background-color: var(--bg2);
`;
