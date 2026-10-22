import { Input } from "~/ui/Button";
import styled from "styled-components";

export const Root = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--bg);
`;

export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 4px;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--b1);
`;

export const Scroll = styled.div`
  position: relative;
  flex: 1 1 0;
  overflow: auto;
  background-color: var(--bg2);
  user-select: none;
`;

export const Grid = styled.div`
  display: grid;
  grid-auto-rows: var(--cell);
  min-width: 100%;
  width: max-content;
`;

const sticky = `
  position: sticky;
  z-index: 2;
  background-color: var(--bg);
`;

const line = `
  border-right: 1px solid var(--b1);
  border-bottom: 1px solid var(--b1);
`;

export const Corner = styled.div`
  ${sticky}
  ${line}
  left: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

export const TagCell = styled.div`
  ${sticky}
  z-index: 3;
  padding: 2px 1px;
  overflow: visible;
  border-bottom: 1px solid var(--b1);
`;

export const TagFill = styled.div`
  ${sticky}
  border-bottom: 1px solid var(--b1);
`;

/** Bracket spanning the tag's frames; the name label sits on its left end */
export const Tag = styled.div`
  position: relative;
  height: 100%;
  cursor: grab;
  touch-action: none;
  border: 2px solid;
  border-top: none;
  font-size: calc(var(--font-size) * .85);

  &:hover > span { filter: brightness(1.15); }
`;

export const TagLabel = styled.span`
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 2px;
  padding: 0 4px;
  white-space: nowrap;
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 rgba(255, 255, 255, .45);
  line-height: calc(var(--cell) - 9px);
  pointer-events: none;
`;

export const FrameHead = styled.div`
  ${sticky}
  ${line}
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
  font-size: calc(var(--font-size) * .8);
  cursor: pointer;

  &[data-loop=true] { box-shadow: inset 0 -3px 0 var(--accent); }
  &[data-onion=true] { box-shadow: inset 0 3px 0 var(--onion); }
  &[data-onion-edge=start] { border-left: 2px solid var(--onion); }
  &[data-onion-edge=end] { border-right: 2px solid var(--onion); }
  &[data-selected=true] { background-color: var(--face); color: var(--fg); }
  &[data-current=true] { background-color: var(--sel); color: var(--sel-fg); }
  &[data-drop=before] { box-shadow: inset 4px 0 0 var(--accent); }
  &[data-drop=after] { box-shadow: inset -4px 0 0 var(--accent); }
`;

export const HeadFill = styled.div`
  ${sticky}
  border-bottom: 1px solid var(--b1);
`;

export const Flag = styled.div`
  position: sticky;
  z-index: 2;
  ${line}
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg);
  color: var(--fg);
  cursor: pointer;

  &[data-current=true] { background-color: var(--face); }
  &[data-dim=true] { color: var(--b2); }
  /* Shown, but hidden by a parent group */
  &[data-inherited=true] { opacity: .4; }
  &:hover { color: var(--accent); }
`;

export const LayerCell = styled.div`
  position: sticky;
  z-index: 2;
  ${line}
  display: flex;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  background-color: var(--bg);
  box-shadow: 2px 0 0 var(--b1);
  cursor: pointer;

  &[data-selected=true] { background-color: var(--face); }
  &[data-current=true] { background-color: var(--face-hot); }
  &[data-drop=above] { box-shadow: inset 0 4px 0 var(--accent), 2px 0 0 var(--b1); }
  &[data-drop=below] { box-shadow: inset 0 -4px 0 var(--accent), 2px 0 0 var(--b1); }
`;

export const Name = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const NameInput = styled.input`
  background-color: var(--field);
  border: 1px solid var(--accent);
  width: 100%;
  user-select: text;
`;

export const Cel = styled.div`
  ${line}
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;

  &[data-cross=true] { background-color: var(--row-hover); }
  &[data-selected=true] { background-color: var(--row-sel); }
  &[data-current=true] { background-color: var(--sel); }
  &[data-drop=true] { outline: 2px dashed var(--accent); outline-offset: -2px; }
  &:hover { background-color: var(--face-hot); }
  &[data-clip=true] { animation: clip-ants .6s steps(2) infinite; outline: 1px dashed var(--fg); outline-offset: -3px; }
  @keyframes clip-ants { 50% { outline-color: var(--b1); } }
  /* Group rows read as one continuous band */
  &[data-group] { border-top-color: transparent; border-bottom-color: transparent; background-image: linear-gradient(transparent 35%, var(--row-sel) 35% 65%, transparent 65%); }
`;

/** Filled cel; linked neighbours stretch into a continuous bar */
export const Key = styled.span`
  width: 50%;
  height: 50%;
  flex-shrink: 0;
  background-color: var(--fg);
  border: 1px solid var(--b1);
  border-radius: 50%;

  &[data-prev=true], &[data-next=true] { border-radius: 0; height: 36%; }
  &[data-prev=true] { width: 75%; margin-left: -25%; border-left: none; }
  &[data-next=true] { width: 75%; margin-right: -25%; border-right: none; }
  &[data-prev=true][data-next=true] { width: 110%; margin: 0; }
  &[data-linked=true] { background-color: var(--accent); }
`;

export const Empty = styled.span`
  width: 30%;
  height: 30%;
  border: 1px solid var(--fg-dim);
  border-radius: 50%;
  opacity: .5;
`;

export const RowFill = styled.div`
  border-bottom: 1px solid var(--b1);

  &[data-current=true] { background-color: var(--row-hover); }
`;

export const Popup = styled.div`
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background-color: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

export const Num = styled(Input)`
  width: 3em;
`;
