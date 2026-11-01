import { createElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Key } from 'react';
import { registerVirtualList, type PxVirtualList, type VirtualWindow } from '@pixprite/ui';

registerVirtualList();

/** React renders rows selected by the shared measured-window/focus controller. */
export function VirtualList<T>({ items, itemKey, render, estimate = 28, maxHeight, className, style, current, measurementKey }: {
  items: readonly T[]; itemKey: (item: T, index: number) => Key; render: (item: T, index: number) => ReactNode;
  estimate?: number; maxHeight: number | string; className?: string; style?: CSSProperties; current?: number; measurementKey?: string;
}) {
  const controller = useRef<PxVirtualList>(null);
  const [window, setWindow] = useState<VirtualWindow>({ indices: [], positions: [0], total: 0 });
  useLayoutEffect(() => {
    controller.current?.configure({ keys: items.map(itemKey), estimate, current, measurementKey, onWindow: setWindow });
  });
  return createElement('px-virtual-list', { ref: controller }, <div data-virtual-scroll className={className}
    style={{ ...style, overflow: 'auto', overflowAnchor: 'none', maxHeight }}>
    <div style={{ height: window.total, position: 'relative', flexShrink: 0 }}>
      {window.indices.filter(index => index < items.length).map(index => <div key={itemKey(items[index], index)} data-virtual-index={index}
        style={{ position: 'absolute', left: 0, right: 0, top: window.positions[index], display: 'flow-root' }}>{render(items[index], index)}</div>)}
    </div>
  </div>);
}
