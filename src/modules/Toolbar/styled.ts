import { bevel } from "~/ui/Button";
import styled from "styled-components";

export const Bar = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
  overflow-y: auto;
  overflow-x: hidden;
`;

export const Tool = styled.button`
  ${bevel}
  position: relative;
  width: calc(var(--tool-icon) * 11px + 10px);
  height: calc(var(--tool-icon) * 11px + 10px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg);
  cursor: pointer;

  &:hover { background-color: var(--face-hot); }

  &[data-active=true] {
    background-color: var(--sel);
    color: var(--sel-fg);
    box-shadow: inset 1px 1px 0 var(--shadow-inset);
  }
`;

/** Small triangle marking a group with more tools */
export const Corner = styled.span`
  position: absolute;
  right: 2px;
  bottom: 3px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-bottom: 4px solid currentColor;
  opacity: .7;
`;

export const Flyout = styled.div`
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  padding: 2px;
  background-color: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

export const FlyItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px 3px 4px;
  cursor: pointer;
  white-space: nowrap;

  &:hover, &[data-active=true] {
    background-color: var(--sel);
    color: var(--sel-fg);
  }
`;

export const Key = styled.span`
  margin-left: auto;
  padding-left: 16px;
  opacity: .6;
`;
