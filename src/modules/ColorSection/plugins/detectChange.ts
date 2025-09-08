import type { ColorSection } from "../ColorSection";
import { effect, untracked } from "@preact/signals-react";

export default (self: ColorSection) => (
  effect(() => {
    const { colorA, colorB, picker } = self;
    const { value: ref } = self.pickerRef;
    if (!ref) return;
    ref.inHSL;
    untracked(() => {
      ref.fromColor(picker ? colorB : colorA);
    });
  })
);