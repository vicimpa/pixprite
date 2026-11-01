/** The editor-supplied, framework-independent UI kit. Importing registers px-* elements. */
import { registerPrimitives } from './primitives';
import { registerSelect } from './select';
import { registerComposites } from './composites';
import { registerVisuals } from './visuals';
import { registerAdaptive } from './adaptive';
import { registerVirtualList } from './virtualization';
import { registerPresentation } from './presentation';
import { registerForm } from './form';

export * from './primitives';
export * from './select';
export * from './composites';
export * from './visuals';
export * from './gradient-pixels';
export * from './adaptive';
export * from './virtualization';
export * from './presentation';
export * from './form';

/** Registration is local to the current document/iframe and safe to repeat. */
export function registerElements(registry: CustomElementRegistry = customElements) {
  registerPrimitives(registry);
  registerSelect(registry);
  registerComposites(registry);
  registerVisuals(registry);
  registerAdaptive(registry);
  registerVirtualList(registry);
  registerPresentation(registry);
  registerForm(registry);
}

if (typeof customElements !== 'undefined') registerElements();

/** Native DOM factories return the public component type after importing the kit. */
declare global {
  interface HTMLElementTagNameMap {
    'px-button': import('./primitives').PxButton;
    'px-input': import('./primitives').PxInput;
    'px-checkbox': import('./primitives').PxCheckbox;
    'px-range': import('./primitives').PxRange;
    'px-label': import('./primitives').PxLabel;
    'px-muted': import('./primitives').PxMuted;
    'px-separator': import('./primitives').PxSeparator;
    'px-flex': import('./primitives').PxFlex;
    'px-grid': import('./primitives').PxGrid;
    'px-panel': import('./primitives').PxPanel;
    'px-head': import('./primitives').PxHead;
    'px-select': import('./select').PxSelect;
    'px-color-input': import('./color-input').PxColorInputElement;
    'px-menu': import('./menu').PxMenuElement;
    'px-menu-bar': import('./menu').PxMenuBarElement;
    'px-dialog': import('./dialog').PxDialogElement;
    'px-slider': import('./drag-controls').PxSliderElement;
    'px-splitter': import('./drag-controls').PxSplitterElement;
    'px-resizer': import('./drag-controls').PxResizerElement;
    'px-form': import('./form').PxFormElement;
    'px-adaptive-bar': import('./adaptive').PxAdaptiveBar;
    'px-floating-panel': import('./adaptive').PxFloatingPanel;
    'px-virtual-list': import('./virtualization').PxVirtualList;
    'px-canvas': import('./visuals').PxCanvas;
    'px-grid-pattern': import('./visuals').PxGridPattern;
    'px-icon': import('./visuals').PxIcon;
    'px-shader': import('./visuals').PxShader;
    'px-gradient': import('./visuals').PxGradient;
    'px-variables': import('./presentation').PxVariables;
    'px-tooltip': import('./presentation').PxTooltip;
  }
}
