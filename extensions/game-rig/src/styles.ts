/** Layout and game-specific drawings; control appearance/behavior comes from @pixprite/ui-react. */
const base = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: var(--font-size, 12px) var(--font, sans-serif); }
px-input, px-select, px-button { min-width: 0; }
`;
export const settingsCss = base + `
body { overflow-x: hidden; padding: 6px; }
#settings { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
details { border: 1px solid var(--b2); background: var(--bg2); min-width: 0; }
summary { padding: 3px 6px; cursor: pointer; color: var(--accent); user-select: none; }
.body { padding: 4px 6px 6px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.row { display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; min-height: 20px; }
.row > span:first-child { flex: 1 1 8em; min-width: 0; color: var(--fg-dim); }
.row > px-select { flex: 1 1 10em; }
.row input[type=number] { width: 56px; }
.row input[type=color] { width: 32px; padding: 0; }
.unit, .note { color: var(--fg-dim); }
.note { line-height: 1.35; }
.sub { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--b2); color: var(--fg-dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.buttons { display: flex; flex-direction: column; gap: 4px; }
.buttons > px-button { display: flex; }
.buttons button { width: 100%; white-space: normal; height: auto; min-height: var(--row, 24px); }
.buttons.two { flex-direction: row; }
.buttons.two > px-button { flex: 1 1 0; }
.seg { display: flex; flex: 1 1 auto; }
.seg > px-button { display: flex; flex: 1 1 0; }
.seg button { flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 3px; }
.chip { display: flex; max-width: 100%; }
.chip button { gap: 4px; }
.count { font-size: 10px; opacity: .8; }
.count.full { color: var(--accent); opacity: 1; }
.count.none { color: var(--danger); opacity: 1; }
.alt { font-size: 10px; padding: 0 3px; border: 1px solid currentColor; opacity: .8; }
.x { color: var(--danger); }
.chips > px-select { max-width: 100%; }
.compassWrap, .colliderWrap { display: flex; justify-content: center; padding: 4px 0; }
.compass { cursor: pointer; max-width: 100%; }
.collider { cursor: crosshair; image-rendering: pixelated; border: 1px solid var(--b1); max-width: 100%; touch-action: none; }
input.key { width: 64px; text-align: center; cursor: pointer; caret-color: transparent; }
input.key:focus { outline: none; border-color: var(--accent); background: var(--sel); color: var(--sel-fg); }
.sticky { position: sticky; bottom: 0; padding-top: 4px; background: var(--bg); display: flex; }
.sticky > px-button { display: flex; flex: 1; }
.sticky button { flex: 1; }
`;
export const previewCss = base + `
html, body, #root, .preview { height: 100%; }
.preview { display: flex; flex-direction: column; min-height: 0; }
.bar { display: flex; gap: 8px; align-items: center; padding: 3px 6px; flex-wrap: wrap; border-bottom: 1px solid var(--b2); }
.info { margin-left: auto; color: var(--fg-dim); }
canvas { flex: 1; min-height: 0; width: 100%; outline: none; display: block; cursor: crosshair; }
canvas:focus { box-shadow: inset 0 0 0 1px var(--accent); }
.hint { padding: 3px 6px; color: var(--fg-dim); border-top: 1px solid var(--b2); }
`;
