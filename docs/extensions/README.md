# Pixprite extensions

[Русская версия](README.ru.md)

Extensions add commands, tools, filters, panels, importers/exporters, themes, icon packs and languages to Pixprite.
They run sandboxed: the entry code in a module **Web Worker**, panels and widgets in **sandboxed iframes**
(`sandbox="allow-scripts"`, no same-origin). Every API call is an async message to the editor, and the editor
checks it against the permissions in the manifest.

- [Quick start](#quick-start)
- [Layout and build](#layout-and-build)
- [Shared UI components](#shared-ui-components)
- [Shared UI components](#shared-ui-components)
- [Manifest reference](#manifest-reference)
- [Permissions](#permissions)
- [API overview](#api-overview)
- [Localization](#localization)
- [Publishing](#publishing)
- [Samples](#samples)

## Quick start

```sh
cp -r extensions/template extensions/my-ext   # then set "id": "my-ext" in manifest.json
bun run ext:dev                               # serves the sources on http://localhost:5174, watches them
bun run dev                                   # the editor
```

In the editor open **Extensions → Developer**, enter `http://localhost:5174` (every extension the server
builds) or `http://localhost:5174/my-ext/` (one of them) and load it. Then, while the editor is open:

- **Live reload.** Saving a file of the extension (or of `packages/api`) reloads it in the editor at once;
  its open panels come back with it. If its checks fail, the editor shows why.
- **Errors in your terminal.** Uncaught errors, rejected promises and `console.error` / `console.warn`
  of the extension's worker and panels are printed by `ext:dev`, with the stack and where they came from.

```ts
// extensions/my-ext/src/main.ts
import { defineExtension } from "@pixprite/api";

export default defineExtension(ctx => {
  ctx.commands.register('hello', async () => {
    const s = await ctx.sprite.get();
    await ctx.ui.notify(ctx.i18n.t('hello', { w: s.width, h: s.height }));
  });
});
```

## Layout and build

```
extensions/<id>/
  manifest.json
  src/main.ts          → main.js      (manifest "entry": "main.js")
  src/panel.tsx        default React component (page "panel.tsx")
  src/panel.html       optional alternative: a legacy HTML page with src/panel.ts
  src/widget.tsx       default React component (page "widget.tsx", no HTML needed)
  locales/en.json      own strings, required when the manifest uses %key%
  locales/ru.json …
  assets/              copied as is
```

There is no build step. An extension is kept as its sources, and the editor compiles them itself when it
installs or runs one: every `.ts` file loses its types (sucrase), its imports are followed through the
package, and `@pixprite/api` is the editor's own copy of the API. Panel scripts can also import the editor-supplied
`@pixprite/ui`, `@pixprite/ui/elements`, `@pixprite/ui/legacy`, `@pixprite/ui-react`, `react`,
`react/jsx-runtime`, `react-dom` and `react-dom/client`. Other imports are relative files of the
extension; arbitrary npm packages and circular imports are not supported.

| Script | What it does |
|---|---|
| `bun run ext:check` | validates manifests, sources, locale key sets, placeholders and `%key%` references |
| `bun run ext:dev` | serves the sources and the catalog with CORS on port 5174, reloads editors on change, prints their errors |

Both take extension ids to limit the run: `bun run ext:check game-rig`.

In the editor's own dev server (`bun run dev`) the built-in catalog is this `extensions/` folder: the store
lists every extension in it, and an installed one is reinstalled when its files change. `bun run build`
copies the sources and the catalog into the output. The catalog (`registry.json`) is made from the sources:
texts resolved per language, a sha256 of every file (checked on install), and for language packs
`completeness` (percent of core keys translated).

## Shared UI components

The editor and extension panels use the same Web Components from `@pixprite/ui`. The editor supplies
its current implementation when a panel opens; extensions do not bundle a separate UI version.
The components run inside the panel's existing sandbox and use its document, styles and event handlers.

```js
import '@pixprite/ui/elements';

const field = document.createElement('px-select');
field.setAttribute('name', 'movement');
field.innerHTML = `<option value="topdown">Top-down</option>
  <option value="platformer">Platformer</option>`;
field.value = 'topdown';
field.addEventListener('change', () => console.log(field.value));
document.body.append(field);
```

`@pixprite/ui` and `@pixprite/ui/elements` register and export the same component classes. Registration
is idempotent within each iframe. Imports in separate page scripts reuse the same built-in module instances.
These entry points are for browser panel/widget scripts; the extension's background worker has no DOM.
React pages use `@pixprite/ui-react`; the editor's internal `@pixprite/ui/react` entry is not a public sandbox import.

Controls include `px-button`, `px-input`, `px-checkbox`, `px-range`, `px-select`, `px-color-input`,
`px-menu`, `px-menu-bar`, `px-dialog`, `px-slider`, `px-splitter`, `px-resizer` and `px-form`. Layout elements include
`px-label`, `px-muted`, `px-separator`, `px-flex`, `px-grid`, `px-panel`, `px-head`, `px-adaptive-bar`,
`px-floating-panel`, `px-virtual-list`, `px-variables` and `px-tooltip`. Visual elements include `px-canvas`,
`px-grid-pattern`, `px-icon`, `px-shader` and `px-gradient`.
They inherit the editor's theme variables (`--fg`, `--bg`, `--face`, `--row`, etc.); theme changes reach open panels.

Native controls stay in the light DOM so their names, labels, form submission and native input/change
handlers continue to work. You can supply an existing native child, for example
`<px-input><input type="number" min="0" max="100" value="25"></px-input>`.
Use properties for programmatic updates (`field.value`, `field.disabled`); changing an existing native
select directly requires its usual `change` event or the host's `refresh()` method.
The select popup scrolls locally and closes on outside press or Escape without moving the panel.
`px-form` accepts `schema`, `values`, `palette` and `inline` properties, and emits `valuechange` with
the complete values object in `event.detail`. Resolve editor-specific layer/tag choices before passing the schema.

Existing extension HTML is enhanced automatically: native buttons, text/number fields, checkboxes,
ranges, color fields and single selects are adopted by the shared components. Dynamically inserted
controls are included. Multiple/listbox selects, file fields and hidden inputs retain their native behavior.
The original native element and its event listeners are retained as light-DOM children of a `px-*` wrapper.
The adapter carries over ordinary layout declarations; new panels can use explicit `px-*` markup directly.
The `@pixprite/ui/legacy` entry point
also exports `enhanceLegacyControls(document)` for explicitly enhancing another document.

## React pages (TSX)

Set a panel or widget's `page` to `widget.tsx` (or `src/widget.tsx`) and default-export a
component. The editor compiles JSX automatically, connects the page API, and mounts the
component in `#root`. No HTML, React global, `createRoot` call or extension build step is needed.
An absent `widget.html` with a matching `src/widget.tsx` also uses this mode.

```json
{
  "permissions": ["ui:panel"],
  "contributes": {
    "widgets": [{ "id": "counter", "slot": "toolbar", "page": "widget.tsx" }]
  }
}
```

```tsx
// src/widget.tsx
import { useState } from 'react';
import { Button, type ExtensionPageProps } from '@pixprite/ui-react';

export default ({ ctx }: ExtensionPageProps) => {
  const [count, setCount] = useState(0);
  return <Button onClick={() => setCount(n => n + 1)}>
    {ctx.i18n.t('widget.clicks', { count })}
  </Button>;
};
```

Add `"widget.clicks": "Clicks: {count}"` to the extension's English locale (and translations).
A component with no props, such as `export default () => <Button>Hello</Button>`, works too.
`ctx` includes `role` (`panel`/`widget`), `contribution`, and the same permission-checked APIs as
`connect()`. React hooks and relative TSX component imports work normally. The kit exports
`Button`, `Input`, `TextArea`, `Check`, `Range`, `Label`, `Muted`, `Separator` and `Select`.

Pixprite supplies React, React DOM and the kit at its installed versions inside the iframe;
there is no CDN or access to the parent document. Built-in modules are shared across page scripts.
Render/import errors appear in the page, and a page ending unmounts its React root.
Existing HTML pages keep their script behavior; to mount React there explicitly, import
`mountPage` from `@pixprite/ui-react` and call `await mountPage(Component)` with a `#root` present.

Use `jsx: "react-jsx"` for local type checking; `extensions/tsconfig.json` already configures it
and the `@pixprite/ui-react` path alias. The [template widget](../../extensions/template/src/widget.tsx)
is a working example. React UI imports are intended for panel/widget iframes, not background Workers.

## Manifest reference

```jsonc
{
  "id": "my-ext",              // [a-z0-9] with "." / "-"; also the i18n namespace ext.my-ext.*
  "name": "%name%",            // %key% = from locales/<lang>.json
  "version": "1.0.0",          // semver
  "apiVersion": 1,
  "minEditorVersion": "0.0.4", // optional inclusive minimum editor version, not a range
  "category": "animation",
  "tags": ["rig", "game-development"],
  "author": "you",
  "description": "%description%",
  "icon": "assets/icon.svg",
  "entry": "main.js",          // runs src/main.ts; no entry = data-only extension (themes, icon packs, languages)
  "public": true,              // false: stays in the repository, never published (templates, work in progress)
  "permissions": ["sprite:read", "sprite:write"],
  "contributes": {
    "commands":  [{ "id": "hello", "label": "%cmd.hello%", "menu": "help", "key": "Ctrl+Shift+H", "when": "sprite",
                    "public": true, "params": [{ "key": "name", "type": "text", "label": "Who to greet" }] }],
    "tools":     [{ "id": "stamp", "label": "%tool.stamp%", "icon": "assets/stamp.svg", "group": "paint", "cursor": "crosshair",
                    "options": [{ "key": "size", "type": "slider", "label": "%opt.size%", "min": 1, "max": 32, "default": 4 }] }],
    "filters":   [{ "id": "posterize", "label": "%filter%", "options": [ /* FormSchema */ ] }],
    "panels":    [{ "id": "info", "label": "%panel%", "dock": "right", "page": "panel.html" }],
    "widgets":   [{ "id": "clock", "slot": "statusbar", "page": "clock.html" }],
    "menus":     [{ "location": "layer", "command": "hello" }],
    "importers": [{ "id": "foo", "label": "Foo image", "extensions": ["foo"] }],
    "exporters": [{ "id": "foo", "label": "Foo image", "extensions": ["foo"] }],
    "themes":    [{ "id": "neon", "label": "Neon", "vars": { "--bg": "#0f1d22" } }],
    "iconPacks": [{ "id": "duotone", "label": "%icons.label%", "icons": "icons.json" }],
    "languages": [{ "code": "uk", "name": "Українська", "dir": "ltr", "dict": "uk.json",
                    "extensions": { "game-rig": "game-rig.uk.json" } }],
    "locales": "locales/"
  }
}
```

`minEditorVersion` is an optional inclusive SemVer minimum (for example `"0.0.4"`,
not `">=0.0.4"`). Build metadata is ignored and prereleases sort before the stable release.
Editors from 0.0.4 check it before installation/update, enabling and startup; incompatible
packages cannot register contributions or execute workers/pages. The catalog carries the
same field: its install button explains the required editor version, and incompatible updates
are excluded from update-all. The downloaded manifest is checked again before replacing
an installed version. Extensions without the field keep working.

The context exposes `ctx.editorVersion` independently of `ctx.apiVersion`. Editors before
0.0.4 do not enforce this manifest field. Code extensions that require the new host should
also reject a missing `ctx.editorVersion` at the beginning of `activate`, before registering
commands or changing documents; see [Game rig](../../extensions/game-rig/src/main.ts).
The TSX Game rig panels and template widget require 0.0.4.

`category` is one of `tools`, `animation`, `panels`, `palettes`, `themes`, `icons`,
`languages`, `automation`, `other`. `tags` contains up to 16 unique lowercase slugs
(up to 40 characters each, letters/digits separated by hyphens). Both are optional
for legacy packages. The catalog filters by category and includes tags in text search.
Preferences and the icon menu can open the catalog with a category already selected.

Rules checked by `ext:check` (and again by the editor on install):

- commands, tools, filters, importers and exporters need an `entry`;
- panels and widgets need the `ui:panel` permission;
- paths are relative, without `..`;
- language codes are valid BCP 47 (`Intl.getCanonicalLocales`);
- ids are unique inside each contribution list; the folder name equals `id`.

**FormSchema** is an array of `{ key, type, label, min?, max?, step?, options?, default? }`, where `type` is
`slider | number | color | select | checkbox | text | layer | tag`. The editor renders it with its own controls
(tool options, filter dialogs, `ctx.ui.showForm`).

**Icon packs** replace semantic editor icons. They are data-only contributions with no permissions or worker. Install a pack in Extensions, then choose it in Window → Icon pack (also available in Preferences); the preview updates immediately. The selected pack is remembered independently of the color theme. Outline is the default; both Outline and Pixel are built in and available offline without extensions. Missing icons, disabled packs and removed extensions fall back to Outline. Enabling the selected extension again restores its icons, and switching packs preserves button sizes.

`icons.json` maps names from [the built-in icon list](../../src/ui/Icon/icons.ts) (`pencil`, `eraser`, `play`, `gear`…) to artwork. A pack may replace any subset:

```json
{
  "pencil": { "size": 24, "paths": [{ "d": "M4 20 20 4", "stroke": "foreground" }] },
  "play": { "pixels": "#..\n##.\n###\n##.\n#.." }
}
```

Vector artwork uses a square `size` (1–128) and 1–64 SVG path descriptions. Paths accept only `d`, `fill`, `stroke` and `strokeWidth` (default 1.75); colors are `foreground`, `accent`, `fill` (the theme's icon fill), or `none`. Defaults are no fill, foreground stroke and rounded joins/caps. Pixel grids are rectangular, at most 64×64: `#` is foreground, `o` is icon fill, `+` is accent and `.` is transparent. SVG/HTML markup, URLs and event handlers are not accepted. A JSON file is limited to 256 KiB and 256 icons; path data and coordinates are bounded too. Package hashes and paths use the usual extension checks.

The editor ships complete [pixel](../../src/ui/Icon/icons.ts) and [outline](../../src/ui/Icon/outline.json) artwork, with 63 icons each. The [Duotone extension example](../../extensions/icons-duotone) contributes 16 original two-color icons and inherits the remaining icons from Outline. `bun run ext:check` validates the extension artwork; unit tests check both complete built-in sets. Existing `builtin` pixel preferences and the former pixel/outline extension IDs remain supported.

**Themes** set the editor's css variables. A theme only lists what it changes; the rest comes from the default theme (`src/themes/dusk.json` has every variable with its value).

| Group | Variables |
|---|---|
| Text and surfaces | `--fg --fg-dim --bg --bg2 --b1 --b2 --field --menu --workspace` |
| Buttons and bevels | `--face --face-hot --face-down --hilite --shade --icon-fill` |
| Accents | `--accent --accent-fg --sel --sel-fg --danger --tooltip --tooltip-fg` |
| Shadows | `--shadow` (popups, dialogs), `--shadow-inset` (pressed buttons), `--backdrop` (behind dialogs) |
| Timeline | `--onion` (onion skin range), `--row-hover` (hovered / current row), `--row-sel` (selected cells) |
| Canvas | `--ruler --ruler-fg` (rulers), `--guides`, `--layer-edges` |

Not themable on purpose: the transparency checkerboard and grid colors (user settings, exposed read-only as `--checker-a` / `--checker-b`), color picker gradients, and the black-and-white outlines drawn over pixels (selection, handles), which must stay visible on any artwork.

## Permissions

| Permission | Allows |
|---|---|
| `sprite:read` | `sprite.get/getPixels/render`, selection, sprite events |
| `sprite:write` | pixel writes, layers / frames / tags / slices changes, transactions |
| `tags:lock` | `ctx.locks`: structural locks enforced by the core |
| `ui:panel` | panels and widgets |
| `storage` | `ctx.storage`, a per-extension IndexedDB key/value store |
| `network:<host>` | `ctx.net.fetch` to that host only (`network:*` for any; avoid it) |
| `clipboard` | reserved |

The store shows the requested permissions before installing. Calls without the permission are rejected with
`ExtensionError` (`code: 'permission'`).

## API overview

`ctx` (`ExtensionContext` in `packages/api/src/context.ts`) is the same in the worker (`defineExtension`)
and in panels (`await connect()`). Everything returns a promise.

| Area | Highlights |
|---|---|
| `sprite` | `get()` snapshot, `getPixels(layer, frame, rect?, 'rgba'│'index')`, `putPixels`, `render(frame, {scale, format:'bitmap'│'png'})`, `transaction(label, fn)` = one undo step, `layers/frames/tags/slices` CRUD, `palette.set(colors, {keepPixels})`, `selection.get/set` |
| `documents` | `list`, `active`, `open`, `create`, `on('change')`; `DocumentInfo.project` is a lasting key for your data about a project |
| `events` | `on('sprite:change'│'selection'│'frame'│'tool'│'tags'│'playback'│'history', cb)` |
| `commands` | `register(id, fn)`, `run(id, ...args)` (built-ins with arguments, other extensions' public commands), `list()` with `params`; see below |
| `tools` | `register(id, {onDown, onMove, onUp, onCancel})`, `overlay(pixels)` for the stroke preview |
| `filters`, `io` | `filters.register(id, (pixels, options) => pixels)`, `io.registerImporter/registerExporter` |
| `ui` | `notify`, `confirm`, `prompt`, `pickColor`, `pickFile`, `progress`, `showForm(title, schema)` |
| `view`, `state`, `playback` | zoom/pan and coordinate mapping, `reveal({layer, frame, rect, highlight})` to show a place you changed; fg/bg/tool/brushSize; play/stop/seek |
| `meta` | per sprite/layer/frame/tag/slice/cel data, namespaced by your id, saved in the project file |
| `storage` | `get/set/delete/keys` |
| `locks` | `set({tags: {delete: true}, constraints: {frameMultiple: 4}})`; the core refuses breaking edits and marks them in the UI. Documents remember the owner; opening without the extension offers to unlock |
| `validators` | `register(id, snapshot => Problem[])`, shown in the Problems panel |
| `i18n` | `t`, `core`, `lang`, `dir`, `on('change')`, `number/date/list` |
| `extensions` | `get(id)` → `{ api }` of what another extension's `activate` returned |
| `net` | `fetch(url, init)` limited by `network:<host>` |

Pixels are `{rect, format, data: Uint8ClampedArray}`, 4 bytes per pixel with straight alpha. Buffers are
transferred, not copied, so do not reuse a buffer after sending it.

Wrap related writes into one undo step:

```ts
await ctx.sprite.transaction('Add outline', async tx => {
  const l = await tx.layers.add({ name: 'Outline' });
  await tx.putPixels(l, 0, pixels);
});
```

## Commands

Everything in the editor's menus is a command, and `ctx.commands.run(id)` runs it like the user would.
Commands that ask for settings in a dialog (effects, canvas and sprite size, color mode, layer, frame and
cel properties, selection grow / shrink / border…) also take one object of arguments: then they apply at
once, without the dialog. `ctx.commands.list()` gives each such command's `params` (a `FormSchema`: keys,
ranges, defaults); omitted arguments take the defaults, wrong ones reject.

```ts
await ctx.commands.run('image.canvasSize', { width: 64, height: 64, anchorY: 1 });
await ctx.commands.run('fx.outline', { color: '#1b1a24', scope: 'layer' });
```

**Between extensions.** A command declared with `"public": true` is part of your extension's api: others run it
as `ctx.commands.run('<your id>:<command id>', ...args)` and get what your handler returns. Describe its
arguments in `params` so `list()` shows them. Commands without `public` can be run only by the user and by
your own extension. For a richer api (objects, several functions) return it from `activate` and let others
use `ctx.extensions.get(id)`.

## Localization

- Own strings live in `locales/<lang>.json` with keys **without** the `ext.<id>.` prefix; `en.json` is the reference.
- In the manifest write `"%key%"`; the editor resolves it without running your code.
- In code `ctx.i18n.t('key', { name })` fills `{name}`; `ctx.i18n.core('common.ok')` reads core strings.
- Plurals: give `key.one`, `key.few`, `key.many`, `key.other` and pass `count`: `t('layers', { count: n })`.
  The form is chosen by `Intl.PluralRules`; only `key.other` is required in English.
- Fallback: requested language → base language (`pt-BR` → `pt`) → `en` → the key.
- `ctx.i18n.dir` is `rtl` for right-to-left languages; use logical css properties (`margin-inline-start`).
- **Language packs** are data-only extensions with `contributes.languages`: a flat `dict` of core keys (any subset;
  missing keys fall back to English) and optional translations for other extensions. `completeness` in the
  registry shows how much is done. See `extensions/lang-uk`.

## Publishing

1. Fork the repository and add `extensions/<id>/`.
2. `bun run ext:check` must pass; `bun run typecheck` must stay clean.
3. Provide at least `locales/en.json`; other languages are welcome.
4. Request only the permissions you use; explain `network:` hosts in the PR.
5. Raise `version` whenever the extension's files change (the PR check refuses otherwise): installed
   copies only learn of an update from a higher version.
6. Open a pull request. After merge the extension appears in the store of the hosted editor.

The editor's own build has no extensions. They are published by `.github/workflows/extensions.yml` to the
orphan branch `extensions`: the sources of every extension that isn't `"public": false`, and `registry.json`.
The store reads it through jsDelivr (`https://cdn.jsdelivr.net/gh/vicimpa/pixprite@extensions/registry.json`);
each package path in it is pinned to the commit of its sources, so files are cached for good and a manifest
never meets older sources. More catalogs can be added in Preferences → Extension catalogs.

Publication creates an annotated Git tag `ext-<id>-v<version>` for each package,
including older versions found in published catalog commits. Tags point at the
published source tree, with the package in `<id>/`. `registry.json` v3 retains the
usual `extensions` list and adds a `versions` array to each entry. Its records carry
the same package metadata, immutable commit URL, permissions, editor minimum and file
hashes. Older v2 catalogs and bare arrays are still accepted. An already-published
version with different bytes fails publication; use a new version instead.
The workflow pushes the catalog branch and version tags atomically.

The store selects the newest compatible release and lets the user install an older
one after confirming permissions. An update saves one previous package locally;
**Restore version** uses those bytes offline. Failed contribution loading or worker
activation restores the previous package. A candidate is staged in memory until
activation completes, so closing during activation keeps the last committed package.
Disabled packages stay disabled when updated or restored. Only package files are
restored; extension storage and completed document edits are retained.

Named editor layouts also save extension panel docking, geometry, visibility and the
active dock tabs. Legacy layouts keep the current extension arrangement when first
applied. Missing extensions retain their positions for later installation. Reset layout
restores editor and extension defaults without overwriting a named workspace.

## Samples

| Folder | Shows |
|---|---|
| `extensions/template` | command, panel, locales with plurals, exported api |
| `extensions/theme-neon` | data-only theme |
| `extensions/icons-duotone` | data-only two-color icons with built-in Outline fallback |
| `extensions/lang-uk` | data-only language pack (partial Ukrainian) |
| `extensions/game-rig` | tag presets in meta, locks, validator, exporter (zip with sheet.png + rig.json), live game preview panel |
| `extensions/ai-assistant` | chat panel with an OpenAI-compatible API (DeepSeek by default), function calls mapped to ctx, each AI edit one undo step |


### AI assistant task skills

The assistant ships with six built-in skills in `extensions/ai-assistant/src/skills.ts`:

| Skill | Task |
| --- | --- |
| `inspect-sprite` | Inspect pixels, layer/frame structure and animation tags |
| `draw-pixel-art` | Draw silhouettes, color clusters and new sprite details |
| `edit-sprite` | Make local edits while preserving neighboring pixels and transparency |
| `animate-sprite` | Create poses, adjust timing and maintain inclusive tag ranges |
| `palette-colors` | Choose between palette changes and pixel recoloring in RGB/indexed mode |
| `editor-commands` | Discover actual commands and apply their parameter schemas |

Every model request contains the short skill catalogue. The model loads a matching
instruction with `read_skill({ name })`; the full set of guides is not repeated in
its system prompt. A skill has a name, description, tool list and Markdown instructions.
Adding an entry updates the catalogue and the tool's allowed names automatically.
The editor compiles these ordinary extension modules; this needs no new sandbox API.

The guides describe the tools actually exposed by this assistant. `render_png` displays
a PNG to the user but sends only metadata to the model; the model inspects cel colors
with `get_pixels`. `get_selection` returns bounds, a selected-pixel count and small
masks. Pixel writes overwrite their full rectangles and ignore the selection mask.
Malformed colors and uneven pixel rows are rejected before writing. If the active
document changes while a model reply is pending, further tools for that request stop.

The guides improve the context supplied to a model; they do not guarantee its choices.
Provider-independent tests cover skill loading, tool arguments, actual pixel edits and
document switching without making paid requests to a live model.
