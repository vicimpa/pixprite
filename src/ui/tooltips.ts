import '@pixprite/ui/elements';
import type { PxTooltip } from '@pixprite/ui/elements';
import { keyNames } from '~/core/i18n';

/** The shared tooltip discovers titles; the editor formats its own key names. */
export function installTooltips() {
  const tooltip = document.createElement('px-tooltip') as PxTooltip;
  tooltip.format = keyNames;
  document.body.append(tooltip);
  return () => tooltip.remove();
}
