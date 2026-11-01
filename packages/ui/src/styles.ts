/** Scoped styles shared verbatim by the editor and each extension document. */
export const pxStyles = `
px-button,px-input,px-checkbox,px-range,px-select,px-label,px-muted {display:contents}
.px-ui-button,.px-ui-input,.px-ui-checkbox,.px-ui-range,.px-select,.px-select-list,.px-select-item {box-sizing:border-box;font:inherit;color:var(--fg,inherit)}
.px-ui-button,.px-select {height:var(--row,24px);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite);background-color:var(--face);display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.px-ui-button {justify-content:center;padding:0 .5em 1px;box-shadow:inset 1px 1px 0 var(--hilite),inset -1px -2px 0 var(--shade)}
.px-ui-button[data-px-primary=true],.px-ui-button.primary,.px-ui-button.px-primary {background-color:var(--accent);color:var(--accent-fg)}
.px-ui-button[data-px-active=true],.px-ui-button.on,.px-ui-button.px-active {background-color:var(--sel);color:var(--sel-fg);box-shadow:inset 1px 1px 0 var(--shadow-inset)}
.px-ui-button[data-px-square=true] {width:var(--px-control-size,var(--row,24px));padding:0}
.px-ui-button[data-px-size] {height:var(--px-control-size)}
.px-ui-button:hover:not(:disabled):not([data-px-primary=true]):not([data-px-active=true]),.px-select:hover:not(:disabled) {background-color:var(--face-hot)}
.px-ui-button:active:not(:disabled) {background-color:var(--face-down);box-shadow:inset 1px 1px 0 var(--shade);padding-top:1px}
.px-ui-button:disabled,.px-select:disabled {color:var(--fg-dim);cursor:default}
.px-ui-button:disabled {opacity:.6}
.px-ui-button[hidden] {display:none!important}
.px-ui-button:focus-visible,.px-select:focus-visible {outline:1px solid var(--accent)}
.px-ui-input {height:var(--row,24px);width:3.6em;padding:0 4px;background:var(--field);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--shade);user-select:text;-webkit-user-select:text}
.px-ui-input:focus {border-color:var(--accent);outline:none}
.px-ui-input[type=number]::-webkit-inner-spin-button {opacity:.5}
.px-ui-checkbox {appearance:none;-webkit-appearance:none;width:calc(var(--font-size,12px) + 2px);height:calc(var(--font-size,12px) + 2px);background:var(--field);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--shade);cursor:pointer;flex-shrink:0}
.px-ui-checkbox:checked {background:linear-gradient(var(--accent),var(--accent)) center / 6px 6px no-repeat,var(--field)}
.px-ui-range {appearance:none;-webkit-appearance:none;height:var(--row,24px);width:6em;background:transparent;cursor:pointer}
.px-ui-range::-webkit-slider-runnable-track {height:8px;background:var(--field);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--shade)}
.px-ui-range::-webkit-slider-thumb {appearance:none;-webkit-appearance:none;width:8px;height:14px;margin-top:-4px;background:var(--face);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite)}
.px-ui-range::-moz-range-track {height:8px;background:var(--field);border:1px solid var(--b1)}
.px-ui-range::-moz-range-thumb {width:8px;height:14px;border-radius:0;background:var(--face);border:1px solid var(--b1)}
.px-ui-label {display:inline-flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;flex-shrink:0}
.px-ui-muted {color:var(--fg-dim);white-space:nowrap}
px-separator {display:block;width:1px;align-self:stretch;margin:3px 2px;background:var(--b2);flex-shrink:0}
px-flex {--px-display:flex;--px-position:relative;--px-direction:row;--px-content:normal;--px-items:normal;--px-gap:var(--gap,0px);--px-grow:0;--px-shrink:1;--px-padding:0;--px-basis:auto;--px-inset:auto;--px-overflow:visible;display:var(--px-display,flex);position:var(--px-position,relative);min-width:0;flex-direction:var(--px-direction,row);justify-content:var(--px-content,normal);align-items:var(--px-items,normal);gap:var(--px-gap,var(--gap,0px));flex-grow:var(--px-grow,0);flex-shrink:var(--px-shrink,1);padding:var(--px-padding,0);flex-basis:var(--px-basis,auto);inset:var(--px-inset,auto);overflow:var(--px-overflow,visible)}
px-flex[wrap] {flex-wrap:wrap}
px-grid {display:grid;min-width:0;gap:var(--px-gap,0px);grid-template-columns:var(--px-columns,none)}
px-panel {display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg);color:var(--fg)}
px-panel[variant=inset] {position:absolute;inset:0;background-color:var(--bg2);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--shade)}
px-panel[variant=inset]>.px-panel-content {position:absolute;inset:1px;border:none;background-color:var(--bg2)}
px-head {display:flex;align-items:center;height:var(--row,24px);padding:0 6px;background:var(--face);border-bottom:1px solid var(--b1);flex-shrink:0}
.px-select {max-width:100%;min-width:0;gap:6px;padding:0 4px 0 6px;text-align:left}
.px-select>span {flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.px-select>svg {flex-shrink:0}
.px-select[aria-expanded=true] {background-color:var(--face-down,var(--face))}
.px-select[aria-invalid=true] {border-color:var(--danger)}
.px-select-list {position:fixed;z-index:1100;overflow:auto;padding:2px;margin:0;background:var(--menu);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite),3px 3px 0 var(--shadow)}
.px-select-item {display:flex;align-items:center;min-height:var(--row,24px);padding:0 8px;white-space:nowrap;cursor:pointer}
.px-select-item[data-active=true] {background-color:var(--sel);color:var(--sel-fg)}
.px-select-item[data-selected=true] {font-weight:600}
.px-select-item[data-disabled=true] {color:var(--fg-dim);cursor:default}
`;
