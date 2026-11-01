import "@pixprite/ui/elements";
import { createElement } from "react";
import { prop, reactive } from "@vicimpa/decorators";
import { Vec2, vec2 } from "@vicimpa/glm";
import { signalRef } from "~/utils/signals";
import { Reactive } from "~/core/Reactive";
import { batch, effect } from "@preact/signals-react";
import { useEffect } from "~/utils/decorators";
import type { PxSliderElement, SliderPosition } from "@pixprite/ui/elements";

export type SliderProps = { freezeX?: true; freezeY?: true; flipX?: true; flipY?: true; line?: true; onChange?: (pos: Vec2, alt: boolean) => any; };

/** Signal fields preserve the color picker's adapter API; interaction is shared. */
@reactive()
export class Slider extends Reactive<SliderProps> {
  ref = signalRef<PxSliderElement>();
  @prop x = .5;
  @prop y = .5;
  @prop drag = false;
  @prop alt = false;

  @useEffect()
  connect() {
    return effect(() => {
      const element = this.ref.value;
      if (!element) return;
      const changed = (event: Event) => {
        const detail = (event as CustomEvent<SliderPosition>).detail;
        const wasDragging = this.drag;
        batch(() => { this.x = detail.x; this.y = detail.y; this.drag = detail.drag; this.alt = detail.alt; });
        if (detail.drag || !wasDragging) this.props.onChange?.(vec2(detail.x, detail.y), detail.alt);
      };
      element.addEventListener('px-slider-change', changed);
      return () => element.removeEventListener('px-slider-change', changed);
    });
  }

  @useEffect()
  sync() {
    return effect(() => {
      const element = this.ref.value;
      if (!element) return;
      Object.assign(element, { x: this.x, y: this.y, freezeX: !!this.$props.freezeX, freezeY: !!this.$props.freezeY, flipX: !!this.$props.flipX, flipY: !!this.$props.flipY, line: !!this.$props.line });
      element.updatePoint();
    });
  }

  render() { return createElement('px-slider', { ref: this.ref }); }
}
