import { vec2 } from "@vicimpa/glm";
import type { Slider } from "../Slider";
import { batch, effect, untracked } from "@preact/signals-react";

export default (self: Slider) => (
  effect(() => {
    const { drag, alt, flipX, flipY } = self;
    const { value: mouse } = self.mouse;
    if (!drag || !mouse) return;

    batch(() => {
      self.x = flipX ? 1 - mouse.x : mouse.x;
      self.y = flipY ? 1 - mouse.y : mouse.y;
    });

    untracked(() => {
      self.props.onChange?.(vec2(self.viewX, self.viewY), alt);
    });
  })
); 