import { windowEvents } from "@vicimpa/events";
import { useEffect, useRef, type FC, type PropsWithChildren } from "react";
import { dispose } from "$utils/misc";

export type OutsideClick = {
  onOutsideClick?: () => any;
} & PropsWithChildren;

export const OutsideClick: FC<OutsideClick> = ({ children, onOutsideClick }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => (
    dispose(
      windowEvents('mousedown', ({ target }) => {
        do {
          if (target === ref.current)
            return;

          if (target instanceof HTMLElement) {
            if (target.parentElement === ref.current)
              return;

            target = target.parentElement;
            continue;
          }
        } while (target instanceof HTMLElement);

        onOutsideClick?.();
      }),
      windowEvents('blur', () => {
        onOutsideClick?.();
      })
    )
  ));

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
};