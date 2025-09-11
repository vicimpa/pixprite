import { Component } from "react";
import { signal, Signal } from "@preact/signals-react";
import { entries } from "$utils/object";

export type ReactiveProps<T> = {
  readonly [K in keyof T]: T[K]
};

type ReactivePropsRaw<T> = {
  [K in keyof T]?: Signal<T[K]>
};

const props = Symbol('props');
const signals = Symbol('signals');
const self = Symbol('self');

export class Reactive<T extends object> extends Component<T> {
  [props] = this.props;
  [signals]: ReactivePropsRaw<T> = {};
  [self] = Object.defineProperties(this, {
    props: {
      get: () => {
        return this[props];
      },
      set: (newProps: T) => {
        this[props] = newProps;

        entries(newProps)
          .forEach(([key, value]) => {
            const data = this[signals][key] ?? (
              this[signals][key] = signal(value)
            );
            data.value = value;
          });
      }
    }
  });

  $props = new Proxy({} as ReactiveProps<T>, {
    get: (
      (_: any, key: keyof T) => {
        const data = this[signals][key] ?? (
          this[signals][key] = signal(this.props[key])
        );
        return data.value;
      }
    ) as any
  });

}