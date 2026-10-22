import styled from "styled-components";

export const Root = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
`;

export const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--b1);
  overflow: hidden;
`;

export const Count = styled.span`
  color: var(--fg-dim);
  padding: 0 4px;
`;

export const Warn = styled.button`
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 4px;
  height: var(--row);
  color: var(--accent-fg);
  background: var(--accent);
  border: 1px solid var(--b1);
  cursor: pointer;
  white-space: nowrap;
`;

export const List = styled.div`
  flex: 1 1 0;
  overflow-y: auto;
  padding: 3px;
  display: grid;
  gap: 1px;
  align-content: start;
  user-select: none;
`;

export const Swatch = styled.div`
  position: relative;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55);

  &:hover { box-shadow: inset 0 0 0 1px var(--fg); }

  &[data-selected=true] {
    box-shadow: inset 0 0 0 1px #000, inset 0 0 0 2px #fff;
  }

  &[data-drop=true]::before {
    content: '';
    position: absolute;
    left: -2px;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }
`;

/** Primary: triangle in the top-left corner */
export const MarkA = styled.span`
  position: absolute;
  left: 0;
  top: 0;
  border-top: 7px solid #fff;
  border-right: 7px solid transparent;
  filter: drop-shadow(0 0 1px #000);
`;

/** Secondary: small triangle in the bottom-right corner */
export const MarkB = styled.span`
  position: absolute;
  right: 0;
  bottom: 0;
  border-bottom: 5px solid #000;
  border-left: 5px solid transparent;
  filter: drop-shadow(0 0 1px #fff);
`;

/** Indexed mode: the entry that means transparency */
export const MarkT = styled.span`
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent calc(50% - 1px), #f00 50%, transparent calc(50% + 1px));
`;

export const Recent = styled.div`
  display: flex;
  flex-shrink: 0;
  gap: 1px;
  height: 12px;
  margin-top: 2px;
  overflow: hidden;

  & > span {
    flex: 0 0 12px;
    cursor: pointer;
    border: 1px solid var(--b1);
  }
`;
