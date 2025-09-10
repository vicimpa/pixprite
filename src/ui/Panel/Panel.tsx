
import type { FC, JSX } from "react";
import * as styled from "./styled";

export const Panel: FC<JSX.IntrinsicElements['div']> = ({ children, ...props }) => {
  return (
    <styled.Panel {...props}>
      <styled.PanelContent>
        {children}
      </styled.PanelContent>
    </styled.Panel>
  );
};
