import { windowEvents } from "@vicimpa/events";
import type { Slider } from "../Slider";

export default (self: Slider) => (
  windowEvents(['mouseup', 'blur'], () => {
    self.drag = false;
    self.alt = false;
  })
);