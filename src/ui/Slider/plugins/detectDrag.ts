import { vec2 } from "@vicimpa/glm";
import type { Slider } from "../Slider";
import { batch, effect } from "@preact/signals-react";

export default (self: Slider) => (
  effect(() => {
    const { drag, alt } = self;
    const { value: mouse } = self.mouse;

    if (!drag || !mouse) return;
    batch(() => {
      self.x = mouse.x;
      self.y = mouse.y;
      self.props.onChange?.(vec2(self.viewX, self.viewY), self.alt);
    });
  })
); 