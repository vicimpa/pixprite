import type { FC, PropsWithChildren } from "react";
import { createPortal } from "react-dom";

export const Head: FC<PropsWithChildren> = ({ children }) => {
  return createPortal(children, document.head);
};