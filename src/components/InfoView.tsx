import { Component, useEffect, useRef, type PropsWithChildren, type ReactNode } from "react";
import { computed } from "@preact/signals-react";
import { prop, reactive } from "@vicimpa/decorators";
import { connect } from "@vicimpa/react-decorators";
import { dispose } from "../utils/misc";
import { windowEvents } from "@vicimpa/events";

const INFO_STORE = new WeakMap<HTMLElement, ReactNode>();

const findTarget = (target: EventTarget | null): ReactNode | undefined => {
  if (!(target instanceof HTMLElement))
    return;

  do {
    const info = INFO_STORE.get(target);

    if (info)
      return info;

    target = target.parentElement;
  } while (target instanceof HTMLElement);

  return undefined;
};

@connect((self) => (
  dispose(
    windowEvents('mousedown', ({ target }) => {
      self.first = findTarget(target);
    }),
    windowEvents(['mouseup', 'blur'], () => {
      self.first = undefined;
    }),
    windowEvents('mousemove', ({ target }) => {
      self.last = findTarget(target);
    })
  )
))
@reactive()
export class InfoView extends Component<{ defaultInfo?: ReactNode; }> {
  @prop first?: ReactNode;
  @prop last?: ReactNode;

  view = computed(() => {
    const a = this.first;
    const b = this.last;
    return a ?? b ?? this.props.defaultInfo;
  });

  render() {
    return (
      <div className="text-gray-400">
        {this.view}
      </div>
    );
  }

  static Item = ({ info, children }: PropsWithChildren<{ info: ReactNode; }>) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!ref.current) return;
      const element = ref.current;
      INFO_STORE.set(element, info);

      return () => {
        INFO_STORE.delete(element);
      };
    }, [info]);

    return (
      <div className="contents" ref={ref}>
        {children}
      </div>
    );
  };
}