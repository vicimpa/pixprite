import { Vec2, vec2 } from "@vicimpa/glm";

const point = vec2();
const size = vec2();

export function getMouseVec(
  e: MouseEvent,
  el?: HTMLElement,
  clamp = false,
  normalize = false,
  update?: (v: Vec2) => Vec2
) {
  point.copy(e);

  if (el) {
    const rect = el.getBoundingClientRect();
    size.set(rect.width, rect.height);

    point.sub(rect);

    if (normalize) {
      point.div(size);
    }

    if (clamp) {
      point.max(point, 0).min(point, normalize ? 1 : size);
    }
  }

  const out = point.clone();
  return update ? update(out) : out;
}
