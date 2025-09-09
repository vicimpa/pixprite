import type { FC, PropsWithChildren } from "react";
import styled from "styled-components";


const PanelTop = styled.div<{ $relative?: boolean; }>`
  ${p => !p.$relative ? `
    position: absolute;
    inset: 0;
    overflow: hidden;
  ` : `
    position: relative;
    padding: 2px;
  `}
  background-color: #353535;
`;

const PanelBottom = styled.div<{ $relative?: boolean; }>`  
  ${p => !p.$relative ? `
    position: absolute;
    inset: 2px;
  ` : `
    position: relative;
    padding: 2px;
  `}
  background-color: #131315;
`;

export type PanelProps = {
  relative?: boolean;
} & PropsWithChildren;

export const Panel: FC<PanelProps> = ({ children, relative }) => {
  return (
    <PanelTop $relative={relative}>
      <PanelBottom $relative={relative}>
        {children}
      </PanelBottom>
    </PanelTop>
  );
};