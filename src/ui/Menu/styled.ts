import styled from "styled-components";

export const Bar = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  background-color: var(--face);
  border-bottom: 1px solid var(--b1);
  box-shadow: inset 0 1px 0 var(--hilite);
  padding: 0 2px;
`;

export const Title = styled.div`
  display: flex;
  align-items: center;
  padding: 0 7px 1px;
  cursor: pointer;

  &:hover, &[data-open=true] {
    background-color: var(--sel);
    color: var(--sel-fg);
  }
`;

export const List = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 12em;
  padding: 2px;
  background-color: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

export const Item = styled.div`
  display: flex;
  align-items: center;
  height: var(--row);
  padding: 0 2px;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not([data-disabled=true]), &[data-open=true] {
    background-color: var(--sel);
    color: var(--sel-fg);
  }

  &[data-disabled=true] {
    color: var(--fg-dim);
    cursor: default;
  }
`;

export const Mark = styled.span`
  width: calc(var(--glyph) * 7px + 2px);
  display: flex;
  justify-content: center;
  flex-shrink: 0;
`;

export const Text = styled.span`
  flex-grow: 1;
`;

export const Shortcut = styled.span`
  padding-left: 16px;
  opacity: .6;
`;

export const Divider = styled.div`
  height: 1px;
  margin: 3px 2px;
  background-color: var(--b2);
`;
