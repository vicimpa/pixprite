import type { Dispose } from "$utils/common";
import { type FC, useEffect as useReactEffect, Component, type PropsWithChildren, useState } from "react";

type EffectProps = {
  target: any;
  method: () => any;
  every: boolean;
  trigger: symbol;
} & PropsWithChildren;

const Hook: FC<EffectProps> = ({ target, method, every, trigger, children }) => {
  const [count, setCount] = useState(0);
  target[trigger] = setCount.bind(null, v => v + 1);
  useReactEffect(() => method.apply(target), every ? undefined : [count]);
  return children;
};

export const useEffect = (every = false) => (<
  J extends Component,
  D extends Dispose
>(_target: J, _: keyof J, { value }: TypedPropertyDescriptor<D>) => {
  const { render: _render } = _target;
  if (!_render || !value) return;
  const trigger = Symbol('trigger');

  _target.render = function render(this: J) {
    return (
      <Hook
        target={this}
        method={value}
        every={every}
        trigger={trigger}
      >
        {_render.apply(this)}
      </Hook >
    );
  };

  return {
    value(this: any) {
      this[trigger]?.();
    }
  } as any;
}
);