import { installStyle, installStyles } from './base';

export function installCompositeStyles(doc: Document) {
  installStyles(doc);
  installStyle(doc, 'pixprite-ui-composites', `
px-menu,px-menu-bar,px-dialog[embedded],px-slider,px-color-input,px-splitter,px-resizer{display:contents}
.px-menu-bar{position:absolute;inset:0;display:flex;align-items:stretch;background:var(--face);border-bottom:1px solid var(--b1);box-shadow:inset 0 1px 0 var(--hilite);padding:0 2px}
.px-menu-title{display:flex;align-items:center;padding:0 7px 1px;cursor:pointer}
.px-menu-title:hover,.px-menu-title[data-open=true],.px-menu-item:hover:not([data-disabled=true]),.px-menu-item[data-open=true],.px-menu-item[data-active=true]{background:var(--sel);color:var(--sel-fg)}
.px-menu-list{position:fixed;z-index:1000;min-width:12em;padding:2px;background:var(--menu);color:var(--fg);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite),3px 3px 0 var(--shadow)}
.px-menu-item{display:flex;align-items:center;height:var(--row,24px);padding:0 2px;gap:4px;cursor:pointer;white-space:nowrap}
.px-menu-item[data-disabled=true]{color:var(--fg-dim);cursor:default}
.px-menu-mark{width:calc(var(--glyph,1)*7px + 2px);display:flex;justify-content:center;flex-shrink:0}
.px-menu-text{flex-grow:1}.px-menu-shortcut{padding-left:16px;opacity:.6}.px-menu-divider{height:1px;margin:3px 2px;background:var(--b2)}
px-dialog:not([embedded]),.px-dialog-backdrop{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:var(--backdrop)}
px-dialog:not([open]){display:none!important}
.px-dialog-window{min-width:240px;max-width:min(560px,calc(100vw - 16px));max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite),4px 4px 0 var(--shadow)}
.px-dialog-window[data-wide=true]{max-width:calc(100vw - 16px)}
.px-dialog-title{display:flex;align-items:center;justify-content:space-between;height:var(--row,24px);padding:0 4px 0 8px;background:var(--sel);color:var(--sel-fg);cursor:move;touch-action:none;user-select:none;flex-shrink:0}
.px-dialog-title[data-close-left=true]{flex-direction:row-reverse;justify-content:flex-end;gap:6px;padding:0 8px 0 4px}
.px-dialog-close{width:calc(var(--row,24px) - 6px);height:calc(var(--row,24px) - 6px);display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:inherit;cursor:pointer}
.px-dialog-close:hover{background:var(--danger)}
.px-dialog-body{padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0}
.px-dialog-body>*{flex-shrink:0}
.px-dialog-body label{white-space:normal;flex-shrink:0;min-width:0;line-height:1.3}.px-dialog-body label input[type=checkbox]{flex-shrink:0;align-self:flex-start;margin-top:2px}.px-dialog-body>span,.px-dialog-body>px-muted>span{white-space:normal;line-height:1.35}
.px-dialog-footer{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px 8px;border-top:1px solid var(--b2);flex-shrink:0}
.px-dialog-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.px-field-label{min-width:6em;color:var(--fg-dim)}.px-dialog-section{color:var(--accent);border-bottom:1px solid var(--b2);padding-bottom:2px;margin-top:4px}
.px-splitter{display:block;flex-shrink:0;touch-action:none;user-select:none;background:var(--bg)}.px-splitter[data-splitter=columns]{width:4px;cursor:col-resize}.px-splitter[data-splitter=rows]{height:4px;cursor:row-resize}.px-splitter:hover,.px-splitter[data-drag=true]{background:var(--sel)}
.px-xy-slider{display:block;position:absolute;inset:0;cursor:pointer;touch-action:none}.px-slider-point{position:absolute;inset:0;margin:auto;width:8px;height:8px;border:2px solid var(--point-color,#fff);pointer-events:none;box-shadow:-1px 0 0 #000,1px 0 0 #000,0 -1px 0 #000,0 1px 0 #000,inset -1px 0 0 #000,inset 1px 0 0 #000,inset 0 -1px 0 #000,inset 0 1px 0 #000;transform:translate(var(--px-x,0px),var(--px-y,0px))}
.px-resizer{position:absolute;z-index:1;--r-size:calc(var(--gap,4px)*2);--p-size:calc(-1.5*var(--gap,4px));--g-size:calc(var(--gap,4px) - 1px);--t-size:30%;touch-action:none}
.px-resizer::after{position:absolute;content:' ';display:block;inset:var(--g-size);background:var(--b2);transform:scale(0);transition:.2s}.px-resizer:hover::after,.px-resizer[data-drag=true]::after{transform:scale(1)}
.px-resizer[data-column=true]{left:0;right:0;height:var(--r-size);cursor:row-resize}.px-resizer[data-column=true]::after{left:var(--t-size);right:var(--t-size)}.px-resizer[data-column=false]{top:0;bottom:0;width:var(--r-size);cursor:col-resize}.px-resizer[data-column=false]::after{top:var(--t-size);bottom:var(--t-size)}
.px-color-swatch{width:40px;height:var(--row,24px);padding:2px;border:1px solid var(--b1);background:var(--face);cursor:pointer}.px-color-swatch>span{display:block;width:100%;height:100%;border:1px solid rgba(0,0,0,.35)}
.px-color-popup{position:fixed;z-index:1100;display:flex;flex-direction:column;gap:6px;width:200px;padding:6px;background:var(--menu);color:var(--fg);border:1px solid var(--b1);box-shadow:inset 1px 1px 0 var(--hilite),3px 3px 0 var(--shadow)}
.px-color-field{position:relative;height:120px;cursor:crosshair;touch-action:none;border:1px solid var(--b1)}.px-color-strip{position:relative;height:12px;cursor:ew-resize;touch-action:none;border:1px solid var(--b1);background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.px-color-marker{position:absolute;width:6px;height:6px;margin:-4px 0 0 -4px;border:1px solid #fff;outline:1px solid #000;pointer-events:none}.px-color-palette{display:grid;grid-template-columns:repeat(auto-fill,14px);gap:2px;max-height:64px;overflow-y:auto}.px-color-palette>button{width:14px;height:14px;padding:0;border:1px solid var(--b1);cursor:pointer}.px-color-hex{font:inherit;height:var(--row,24px);padding:0 4px;color:var(--fg);background:var(--field);border:1px solid var(--b1);user-select:text}
`);
}
