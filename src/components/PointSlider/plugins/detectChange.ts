import { dispose } from "../../../utils/misc";
import type { PointSlider } from "../PointSlider";
import { effect, untracked } from "@preact/signals-react";

export default (self: PointSlider) => (
  dispose(
    effect(() => {
      if (self.drag)
        self.move(self.current);
    }),
    effect(() => {
      if (!self.drag)
        return;
      const { current, alt } = self;

      untracked(() => {
        self.props.onChange?.(current, alt);
      });
    })
  )
);