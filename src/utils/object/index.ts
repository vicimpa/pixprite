type Assign<T extends object, U extends object[]> =
  U extends [infer F, ...infer R]
  ? F extends object
  ? R extends object[]
  ? Assign<T & F, R>
  : T & F
  : T
  : T;

export const {
  assign,
  keys,
  values,
  entries,
} = Object as {
  assign<T extends object, U extends object[]>(target: T, ...source: U): Assign<T, U>;
  keys<T extends object>(obj: T): Array<keyof T>;
  values<T extends object>(obj: T): Array<T[keyof T]>;
  entries<T extends object>(obj: T): Array<{ [K in keyof T]: [K, T[K]] }[keyof T]>;
};