
import type { FC, JSX } from "react";
import * as styled from "./styled";

export type PanelProps = {

} & JSX.IntrinsicElements['div'];

export const Panel: FC<PanelProps> = ({ children, ...props }) => {
  return (
    <styled.Panel {...props}>
      <styled.PanelContent>
        {children}
      </styled.PanelContent>
    </styled.Panel>
  );
};
