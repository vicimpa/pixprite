import { Vec2, vec2 } from "@vicimpa/glm";

const vec = vec2();
const size = vec2();

export function getMouseVec(
  e: MouseEvent,
  el?: HTMLElement,
  clamp = false,
  normalize = false,
  update?: (v: Vec2) => Vec2
) {
  vec.copy(e);

  if (el) {
    const rect = el.getBoundingClientRect();
    size.set(rect.width, rect.height);
    vec.sub(rect);

    if (normalize) {
      vec.div(size);
    }

    if (clamp) {
      vec.max(vec, 0).min(vec, normalize ? 1 : size);
    }
  }

  const out = vec.clone();
  return update ? update(out) : out;
}
