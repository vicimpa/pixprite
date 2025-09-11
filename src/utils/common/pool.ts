import { useEffect, useMemo } from "react";

export class Pool<T> {
  private _items: T[];

  constructor(private _create: () => T, initial = 0) {
    this._items = Array.from({ length: initial }, () => _create());
  }

  give() {
    return this._items.shift() ?? this._create();
  }

  release(item: T) {
    this._items.push(item);
  }
}

export function pool<T extends object>(create: () => T, initial = 0) {
  return new Pool(create, initial);
}

export function usePool<T>(pool: Pool<T>) {
  const item = useMemo(() => pool.give(), [pool]);

  useEffect(() => {
    return () => {
      pool.release(item);
    };
  }, [pool, item]);

  return item;
};