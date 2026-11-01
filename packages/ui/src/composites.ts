import { registerColorInput } from './color-input';
import { registerDialog } from './dialog';
import { registerDragControls } from './drag-controls';
import { registerMenu } from './menu';
import { installCompositeStyles } from './composite-styles';

export { PxColorInputElement } from './color-input';
export { PxDialogElement } from './dialog';
export { PxSliderElement, PxSplitterElement, PxResizerElement, type SliderPosition } from './drag-controls';
export { PxMenuElement, PxMenuBarElement, type MenuEntry, type MenuItems, type MenuDefinition } from './menu';
export { installCompositeStyles } from './composite-styles';
export { trackPointer } from './pointer';

export function registerComposites(registry: CustomElementRegistry = customElements) {
  if (typeof document !== 'undefined') installCompositeStyles(document);
  registerColorInput(registry); registerDialog(registry); registerDragControls(registry); registerMenu(registry);
}
