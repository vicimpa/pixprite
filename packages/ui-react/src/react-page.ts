import { Component, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { connect } from '@pixprite/api';
import type { ExtensionPageProps } from './index';

class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    return this.state.error
      ? createElement('pre', { role: 'alert', style: { whiteSpace: 'pre-wrap' } }, String(this.state.error))
      : this.props.children;
  }
}

/** Automatic for TSX pages; also usable from a custom HTML module script. */
export async function mountPage(Page: ComponentType<ExtensionPageProps>, container = document.getElementById('root')) {
  if (!container) throw new Error('React extension page needs a #root container');
  if (!Page || !['function', 'object'].includes(typeof Page)) throw new Error('TSX page must export a React component as default');
  let alive = true, root: Root | null = null;
  addEventListener('pagehide', () => { alive = false; root?.unmount(); }, { once: true });
  const ctx = await connect();
  if (!alive) return;
  if (ctx.role === 'worker') throw new Error('React pages run in panel/widget iframes');
  root = createRoot(container);
  root.render(createElement(PageBoundary, { children: createElement(Page, { ctx: ctx as ExtensionPageProps['ctx'] }) }));
  return root;
}
