import { vec2, Vec2 } from "@vicimpa/glm";

export class Vec2Set {
  pt = vec2();
  map = new Map<number, Vec2>();

  add(v: Vec2): this {
    this.map.set(v.hash(), v.clone());
    return this;
  }

  delete(v: Vec2): boolean {
    return this.map.delete(v.hash());
  }

  has(v: Vec2): boolean {
    return this.map.has(v.hash());
  }

  clear() {
    return this.map.clear();
  }

  forEach(callback: (value: Vec2, index: number, self: this) => any) {
    let index = 0;
    this.map.forEach((value) => {
      callback(value.clone(), index++, this);
    });
  }
}