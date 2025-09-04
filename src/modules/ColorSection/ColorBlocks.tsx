import styled from "styled-components";

const LIST_GAP = 0;

export const Block = styled.div`
  height: 128px;
  background-blend-mode: overlay;
`;

export const HLBlock = styled(Block)`
  background: 
    linear-gradient(
      to right in hsl longer hue,
      hsl(0, var(--s), 50%) 0%,
      hsl(360, var(--s), 50%) 100%
    ),
    linear-gradient(to top,#000,#fff);
`;

export const SVBlock = styled(Block)`
  background: hsl(var(--h), 100%, 50%);
  background:
    linear-gradient(
      to right, 
      hsl(var(--h), 100%, 100%), 
      hsl(var(--h), 100%, 50%)
    ),
    linear-gradient(to top, #000, transparent);
`;

export const Gradient = styled.div<{ $from: string, $to: string, $param?: string; }>`
  height: 16px;
  position: relative;
  background: linear-gradient(
    to right ${e => e.$param ?? ''},
    ${e => e.$from},
    ${e => e.$to}
  );
`;

export const Btn = styled.button`
  width: 32px;
  height: 32px;
  padding: 2px;
  border: 1px solid #999;
  text-align: center;

  cursor: pointer;
  font-size: 14px!important;
  background-color: #444;

  &[data-active=true] {
    background-color: #391bbf;
  }
  
  &[data-active=false] {
    background-color: #535355;
    opacity: 0.5;
  }
`;

export const ListItem = styled.label`
  cursor: pointer;
  display: inline-flex;
  gap: 2px;
  padding: 0px 8px;
`;

export const ColorItem = styled.div`
  width: var(--size);
  height: var(--size);
  cursor: pointer;
  position: relative;
  border-width: 1px;
  border-color: #000;
  

  &::before,
  &::after {
    content: '';
    position: absolute;
    width: 30%;  
    height: 30%;
    opacity: 0; 
    background: #fff;
    mix-blend-mode: difference;
  }

  &[data-active-a="true"], &[data-active-b="true"] {
    border-color: #fff;
  }
 
  &[data-active-a="true"]::before {
    top: 0;
    left: 0;
    opacity: 1;
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  &[data-active-b="true"]::after {
    right: 0;
    bottom: 0;
    opacity: 1;
    border-radius: 100% 0% 0% 0%;
    clip-path: polygon(100% 100%, 0 100%, 100% 0);
  }
`;

export const ListContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-content: start;
  overflow-y: auto;
  gap: ${LIST_GAP}px;
`;