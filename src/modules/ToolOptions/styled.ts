import styled from "styled-components";

/** 3×3 chooser for the transform pivot */
export const PivotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 7px);
  gap: 1px;
  padding: 1px;
  background-color: var(--b1);
  flex-shrink: 0;
`;

export const PivotCell = styled.div`
  width: 7px;
  height: 7px;
  background-color: var(--face);
  cursor: pointer;

  &[data-active=true] { background-color: var(--accent); }
  &:hover { background-color: var(--face-hot); }
`;
