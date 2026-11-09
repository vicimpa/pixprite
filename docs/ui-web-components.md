# Shared Web Components UI kit

## Objective

The editor and extension panels use the same implementations of reusable controls. The editor supplies the UI runtime to sandboxed extensions, so updating Pixprite updates their controls without republishing extension packages. The editor retains its React application and document model.

## Requirements

- The dependency-free browser core of `@pixprite/ui` owns reusable DOM behavior, styling and public element types. It must not import editor state, React, storage or extension permissions. The optional React adapter entry uses the editor's existing React dependency.
- `@pixprite/ui` and `@pixprite/ui/elements` register the editor-supplied elements inside the current document. `@pixprite/ui/react` supplies editor adapters. Registration is idempotent.
- Native inputs and buttons remain the interactive/form controls. Light DOM controllers allow existing forms, labels, native refs, React events and extension DOM code to keep working. Styles are scoped to kit elements and installed once per document. Shadow DOM is optional rather than a requirement for every element.
- Public controls support values, disabled state, native input/change events, keyboard operation, focus and form submission/reset. Number inputs retain unfinished drafts until commit. Pointer cancellation ends drags cleanly.
- Menus and popups stay in their owner document, fit its viewport, preserve page scroll and dismiss in nesting order. Disconnecting a component releases listeners, observers, animation frames and popups.
- Theme CSS variables remain the styling contract. Components work with English/Russian labels, large fonts and narrow windows.
- Extension import resolution admits the declared UI entry points and package-relative modules; arbitrary imports and path traversal remain rejected. Sandbox CSP and `allow-scripts` isolation remain unchanged.
- Existing extension HTML controls are adapted to the same elements, including dynamically created/rebuilt Game rig forms. The former independent select implementation is removed.
- Canvas, icon, gradient, panel/layout and adaptive/virtualized widgets use shared implementations where they expose reusable UI behavior. Editor-specific data selection and signal subscriptions remain in adapters.
- Existing browser functionality and format/data tests continue to pass. Any bundle-budget change requires a measured explanation; budgets must not be silently increased.

## Editor color popup

Click either current color sample in the Colors panel to edit that primary or secondary
color in an anchored popup. It uses the shared floating panel and the existing color
sliders, keeps the selected HSL/HSV/RGB tab, and exposes HEX plus R/G/B/A values
(0–255). Updates are live; Close, Escape and clicking outside dismiss the popup.

HEX accepts `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`, with an optional `#` and
surrounding whitespace. Invalid or incomplete input keeps the last valid color.
RGB-only HEX input, RGB fields and system picking preserve alpha; RGBA HEX and A
explicitly change it. The same HEX rules apply to the main RGB tab.

System color selection uses the native color input of the browser/WebView. The separate
screen picker prefers the desktop bridge: AppKit NSColorSampler on macOS, a Win32
desktop capture/selection overlay on Windows, and the XDG PickColor portal on Linux.
Browser builds use EyeDropper in a secure context. When neither adapter is available,
the popup explains its availability; status messages wrap inside the popup even with
large fonts. Cancelled screen picking leaves the color unchanged, and closing the popup
aborts a pending screen pick. Actual OS integration still needs a manual check on each
supported platform. See [desktop screen sampling](desktop-mcp.md#screen-color).

## Work plan and ownership

1. Foundation agent: package primitives, styles, registration helpers, number input behavior and Select.
2. Composites agent: menu, dialog/popover, color input, pointer slider, splitter/resizer and editor adapters.
3. Extension agent: controlled imports, sandbox runtime delivery, legacy HTML adapter, extension documentation and Game rig regression coverage.
4. Primary agent: React entry points and primitive adapters; layout/canvas/icon/gradient integration; remaining adaptive/virtualization work; package/build wiring and review of every agent's changes.
5. Integration review: trace each public control to its shared implementation, check lifecycle cleanup and compatibility, exercise both editor and actual installed extensions.
6. Validation: typecheck, unit tests, translation/extension checks, production build and bundle analysis; relevant Chromium and WebKit tests, including dropdowns, drafts, drags, nested popups, forms and responsive layouts.

## Acceptance evidence

The shared package now owns 30 custom elements. Editor adapters delegate native input behavior, numeric drafts, selects, menus, dialogs, color picking, pointer controls, forms, layouts, measured overflow/windowing, canvas/shader/gradient rendering, icons, variables and tooltips to it. The former extension select script, duplicate number-field installer and obsolete editor shader/control implementations were removed. The custom color-slider tracks also adopt the shared Range controller.

`Head` remains a React portal into the editor document head. Application state, translations, artwork/palette selection, command execution and rendering React row contents remain consumer integration. Extension pages retain their sandbox and permission-checked API.

Agent implementation was followed by cross-review and primary-agent integration checks. Review found and fixed native reset timing, disconnect/reconnect state, numeric drafts during overflow moves, labels and required-field focus, legacy responsive layout, nested-menu keyboard behavior, pointer disposal and translucent GPU/fallback gradient parity. Persistent browser regressions cover these contracts.

### Bundle measurement

On 2026-11-01, the migration changed the measured JavaScript gzip sizes as follows:

| Metric | Before migration | Migrated build | New limit |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 382,864 bytes | 417,225 bytes | 425,984 bytes (416 KiB) |
| Total JavaScript | 409,848 bytes | 444,213 bytes | 454,656 bytes (444 KiB) |

The approximately 33 KiB increase includes the expanded kit and the host-supplied module sources required to run the same implementations inside opaque-origin iframes. The build strips TypeScript types/comments and minifies these sandbox sources. They remain inside the counted JavaScript bundle; no executable code is excluded from the budgets. The browser still has one bundle and computation workers remain self-contained. No third-party runtime dependency was added. Limits provide approximately 9–10 KiB of measured headroom.

During development, UI-package changes trigger a full page reload: custom-element registries cannot replace constructors. This was checked in Chromium by changing the source timestamp and observing a new page with registered elements.

### Validation completed

- `bun run typecheck`: passed across all projects, including the UI package and browser tests.
- `bun test`: 289 passed, 1 existing opt-in upstream Aseprite fixture skipped.
- `bun run i18n:check` and `bun run ext:check`: passed.
- `bun run build`: passed; its normal large-chunk advisory remains informational.
- `bun run bundle:check`: passed both budgets and the one-browser-bundle/self-contained-worker graph check.
- Chromium: the complete browser suite passed, **86 tests**. After strengthening the wrapper-aware storage-hint assertions, the six Home language/font cases passed again.
- WebKit: **50 core UI/extension tests** passed, followed by **12 tests** covering broken-WebGL startup, editor/PNG smoke flows, onion-skin pixels and six repeated Home language/font cases (**56 distinct scenarios** overall).
- Real installed Game rig: initial and scrolled dropdowns, mouse/keyboard selection, native state retention and dock resize passed in both engines.
- Manual visual review: desktop English and 360 px Russian/Tiny5/large-text Home captures had no page errors. Diagnostics stay in ignored `dist/`.
- Development reload: changing a UI source timestamp reloaded the page and registered fresh elements.
- `git diff --check`: passed.

The native Tauri executable/installers were not rebuilt in this browser/UI migration; WebKit validation covers the renderer-side contracts.

## React extension pages

`@pixprite/ui-react` exposes the same primitive React adapters to extension pages.
A TSX `page` default export is mounted automatically with a connected `ctx` prop;
HTML pages can call `mountPage` explicitly. Source resolution accepts `widget.tsx`,
`src/widget.tsx`, and a missing `widget.html` backed by `src/widget.tsx`.
Sucrase uses the automatic production JSX transform for TSX modules.

A Vite plugin bundles the installed React, React DOM and JSX runtime into an ESM
source string. The sandbox compiler links it and the adapters into iframe-local
blob modules. Canonical built-in module IDs reuse one React instance across all
scripts in the document. No CDN, parent React internals, same-origin privilege or
network permission is introduced. Root teardown runs on `pagehide`; import and
render failures are displayed in the page. JSX pages are tested with real widget
installation, state updates, child component hooks, native controls and denied RPC.

The isolated renderer cannot share the parent window's React objects. On 2026-11-01,
embedding it changed initial JS from **420,347 to 498,738 bytes** and total JS from
**450,652 to 529,042 bytes** (gzip level 9), approximately **76.5 KiB** additional
compressed JavaScript. Both copies are included in measurements. The browser still
loads one JS bundle; budgets are **512,000 bytes (500 KiB)** initial and
**544,768 bytes (532 KiB)** total, with about 13–15 KiB of headroom.

The frame bridge initializes frames that finished loading before their React effect
connected the listener. A browser regression deliberately delays connection until
after `load`; this covers WebKit's installed-widget startup order.

After the React-page integration and load-order fix, the full Chromium suite passed
**94 tests**. The WebKit UI/extension suite passed **65 tests**, including the actual
installed template widget. Typecheck, 289 unit tests, translations, extension checks,
production build, bundle budgets and the Vite development installation also passed.
