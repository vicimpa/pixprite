export * from '@pixprite/ui/react';
export { mountPage } from './react-page';
import type { ExtensionContext } from '@pixprite/api';

/** Props supplied automatically when a panel/widget page points to a TSX component. */
export type ExtensionPageProps = {
  ctx: ExtensionContext & { role: 'panel' | 'widget'; contribution?: string; };
};
