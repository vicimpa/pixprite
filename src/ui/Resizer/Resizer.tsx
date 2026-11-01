import "@pixprite/ui/elements";
import { createElement, useLayoutEffect, useRef, type FC } from "react";
import { type PxResizerElement } from "@pixprite/ui/elements";

export type ResizerProps = { start?: true; };
export const Resizer: FC<ResizerProps> = ({ start }) => {
  const ref = useRef<PxResizerElement>(null);
  useLayoutEffect(() => { ref.current!.start = !!start; });
  return createElement('px-resizer', { ref });
};
