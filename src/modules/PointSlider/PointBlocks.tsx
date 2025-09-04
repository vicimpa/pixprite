import styled from "styled-components";

export const PointContainer = styled.div`
  width: auto;
  height: auto;
  position: relative;
`;

export const PointBlock = styled.div`
  position: absolute;
  inset: 0;
`;

export const PointView = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  inset: 0;
  margin: auto;
  mix-blend-mode: difference;
  border: 2px solid #fff;
`;