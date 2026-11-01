import { createElement, type FC, type JSX } from 'react';
import '@pixprite/ui/elements';
export type PanelProps = JSX.IntrinsicElements['div'];
export const Panel: FC<PanelProps> = ({ children, ...props }) => createElement('px-panel', { ...props, variant: 'inset' }, <div className="px-panel-content">{children}</div>);
