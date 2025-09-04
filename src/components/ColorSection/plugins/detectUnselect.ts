import type { ColorList } from "../ColorList";

import { effect } from "@preact/signals-react";

export default (self: ColorList) => (
  effect(() => {
    if (self.indexA !== undefined && self.indexA >= self.size)
      self.indexA = undefined;

    if (self.indexB !== undefined && self.indexB >= self.size)
      self.indexB = undefined;
  })
);
