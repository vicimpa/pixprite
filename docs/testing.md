# Tests

Install dependencies with `bun install --frozen-lockfile`.

- `bun test` / `bun run test`: document model, migration, malformed file and format round-trip tests. The network-dependent upstream Aseprite case is skipped by default.
- `bun run test:formats` and `bun run test:migrations`: the format and migration subsets, also run explicitly in CI.
- `bun run test:aseprite`: pinned original Aseprite fixtures; see [the compatibility notes](aseprite-compatibility.md).
- `bun run typecheck`: all TypeScript projects, including unit and browser tests.
- `bun run i18n:check` and `bun run ext:check`: translations and extension packages.

## Browser tests

Run `bunx playwright install chromium` once, then `bun run test:e2e`.
On Linux CI, install system libraries as well: `bunx playwright install --with-deps chromium`.
`bun run test:e2e:smoke` runs the two short editor and PNG import/export workflows.

Playwright builds the application and serves `dist/web` on `127.0.0.1:4173`. Stop any existing server on that port first. Tests use Chromium, isolated browser contexts and one worker. Most scenarios use English interface text and a fixed desktop viewport; responsive cases also cover Russian and smaller windows. Failed runs retain a screenshot and trace in `dist/reports/e2e`; open a trace with `bunx playwright show-trace <path-to-trace.zip>`.

The suite performs real pointer drawing, command palette actions, file selection/download, tab navigation, and page reloads. Browser IndexedDB reads verify the saved documents; PNG comparisons decode the browser's exported image. The production application has no test API.

`e2e/responsive.e2e.ts` verifies that status playback/zoom controls stay at the right edge across long hints and differing frame durations, while the information lane clips. It also checks the tool options, timeline actions and status strip at 800, 1024 and 1280 px with large Russian and English UI. It detects clipped controls as well as scrollbars, verifies the extra-tools palette, and exercises draft/preset retention when controls move into More, nested dropdowns and Escape during a pending transform.

`e2e/ui-elements.e2e.ts` checks the shared Web Components' labels, native FormData/reset/required behavior, numeric drafts, readonly/fieldset semantics and virtual-list keys. `e2e/composite-ui.e2e.ts` covers React/native dialog adoption, menu keyboard/ARIA behavior, declarative forms and drag/reconnect cleanup. `e2e/game-rig.e2e.ts` installs the actual TSX extension and checks dropdowns, dock resizing, input focus, saved settings, collider drags and the game preview; compatibility scenarios also cover catalog gating, rejected updates, stored packages and an older host without version metadata; `e2e/visual-ui.e2e.ts` checks canvas cleanup and GPU/Canvas gradient color/alpha parity. These scenarios run in Chromium and WebKit using the same production bundle.

`e2e/react-widget.e2e.ts` installs the template's real TSX widget, exercises React state
and removes the extension. The TSX cases in `e2e/security.e2e.ts` cover default exports,
manual HTML mounting, shared React instances across scripts, relative TSX imports,
controlled inputs/selects, connected props, errors, cleanup, permission denial and
connecting the bridge after an iframe has already loaded.

Additional scenarios cover a renderer crash via Chromium CDP, session/snapshot restoration, offline reload, replacement of an active Service Worker, GIF export/reimport, extension installation/removal and permission denial, and storage failure/retry. Snapshot timing advances `Date` while leaving browser timers running normally. Quota tests inject an aborted IndexedDB write transaction with a `QuotaExceededError`; they do not fill the host disk. The Service Worker deployment fixture changes the worker revision while preserving application assets; mixed-version HTML/assets are a separate Service Worker test concern in the plan.

The storage controls scenario checks persistence status/request, the quota warning, project/snapshot sizes, ZIP and individual backups, and confirmed cleanup retaining the latest snapshot. Persistence API results and quota estimates are injected because browser policies vary. Unit storage tests use `fake-indexeddb` to verify legacy size reads, retention, archive payloads, and backup reminder state.

`e2e/server.ts` is only a test server. Its loopback-only endpoints serve a tiny extension with per-file SHA-256 hashes and simulate a new Service Worker deployment. They are never included in the production build or deployed site. Browser tests use that local registry and require no external extension service.

`e2e/home-icons.e2e.ts` checks Home text wrapping at 360–1024 px in Russian and English with large fonts. It checks the default Outline set, switches between both built-in sets offline, verifies constant icon dimensions and reload persistence, and preserves former pixel/outline preferences. It also installs the actual Duotone extension from an isolated catalog and checks live switching, disable/re-enable and removal fallback to Outline. Icon pack unit tests validate bounded inert artwork and coverage of the shipped sets.

`e2e/color-popup.e2e.ts` checks editing primary and secondary colors directly from
their samples, HEX/RGB/alpha synchronization, invalid drafts, preserved alpha, tab
selection, keyboard dismissal/focus and English/Russian layouts with large text.
System color and screen selection adapters are simulated for successful, cancelled,
failed and aborted picks; an unsupported runtime keeps the system color action and
explains the unavailable screen picker. These adapter tests do not interact with real
OS dialogs. They also check wrapped availability messages in English/Russian and use
the desktop adapter when EyeDropper is absent. `e2e/panel-layout.e2e.ts` checks sample
wrapping at narrow panel widths. `desktop/screen-color.test.ts` verifies request IDs,
abort handling and listener cleanup; Rust `screen_color::tests` covers session ownership,
cancel-before-start ordering and invalid color results. Real OS sampling remains a manual
check, separate from hidden native startup tests.

`e2e/pen-pressure.e2e.ts` sends pen PointerEvents with controlled pressure and checks
actual exported PNG alpha and live canvas samples. It covers clean lines on/off, brush
sizes 1/6, eraser, a custom brush, corner cleanup, revisited pixels, mouse/disabled
mapping, stabilizer release and a single undo/redo. Interpolated path pixels use the
pressure of the event that adds them; earlier pixels keep their recorded value.
This exercises the browser input path, not a tablet driver. Manual acceptance must
record OS, tablet model and pressure/stabilizer settings.

`e2e/pen-settings.e2e.ts` checks mapping persistence, editor stabilizer restoration,
legacy presets and English/Russian large text at 800/1280 px. Open pencil, eraser or
spray → **Pen** (in **More tool options** if the toolbar is narrow). Pressure mapping is
global; stabilizer strength belongs to editor settings and tool presets, with 0 off.

`e2e/text-tool.e2e.ts` verifies leading/trailing spaces, clearing, multiline input,
live options/color updates, drag-and-continue typing, applying another box/tool,
whitespace without a paint history step, and undo/redo via exported PNG. A delayed
bundled font tests apply/cancel/tool changes, Home/new-document/save transitions,
tab switching and cancellation during a new-box request. Clearing moved text keeps
its latest position. `e2e/mcp-automation.e2e.ts` also checks that opening a comparison
waits for live text and preserves its source pixels.
Text starts at the clicked top-left point; Shift+Enter inserts a line, Enter applies,
Escape cancels. Applied text is raster pixels, not an editable text layer.

`e2e/release-workflow.e2e.ts` imports the existing v5 `docs/assets/beacon.pixprite`
project through Home, opens its library card, edits a pixel and layer opacity, explicitly saves and reloads.
It downloads and reopens both `.pixprite` and `.aseprite` copies, checking the exported
PNG and the five-layer/eight-frame structure throughout the browser workflow. The
fixture's fractional layer opacity is set to 115/255 through the UI before taking
exact PNG references, matching Aseprite's 8-bit opacity precision.

`e2e/desktop-windows.e2e.ts` checks the compact app header, button placement, local tab ordering, removal of detached windows, window controls, close/reopen persistence and migration of old multi-window sessions into one window. Linux CI uses Xvfb with a private D-Bus session; actual minimize/maximize window-manager transitions are checked on macOS/Windows. The three-launch persistence test has a 180-second total budget for cold WebKitGTK starts, while each launch retains its 45-second readiness deadline.

## CI and bundle budgets

Every pull request runs the main CI workflow, including documentation and extension changes. It installs dependencies with a frozen lockfile and Bun 1.4.2, then runs typecheck, unit tests, format round-trips, migrations, translations, extension checks, production build, bundle budgets, and Chromium smoke tests. PR checks use a read-only repository token. Successful pushes to `main` deploy the checked build artifact to `gh-pages` in a separate job with write permission. Browser failures retain traces/screenshots for seven days.

`bun run build && bun run bundle:check` checks the production JavaScript using gzip level 9. The Vite manifest identifies entry points and their static imports; each file is counted once. The total also includes the self-contained workers and Service Worker. The browser UI and codecs share one entry bundle. CSS, fonts, images and JSON are outside these JavaScript budgets.

Budgets in `scripts/bundle-budgets.json` are measured in bytes:

| Metric | Baseline | Limit |
| --- | ---: | ---: |
| Initial JavaScript gzip | ~538,300 | 540,672 (528 KiB) |
| Total JavaScript gzip | ~569,800 | 573,440 (560 KiB) |

The shared Web Components migration and React extension pages on 2026-11-01 raised these limits because the editor also ships the kit's minified module sources and an isolated React renderer for sandboxed panels/widgets. See the [UI migration measurements](ui-web-components.md#bundle-measurement) and [React page measurements](ui-web-components.md#react-extension-pages) for the before/after numbers and rationale. MCP atomic editing adds strict in-editor argument validation using Zod Mini, document/revision guards, selection operations and a visible comparison panel. The original atomic MCP changes added 8 KiB to each budget. Sharing the tool catalogue, JSON schemas, executor and task guides with AI Assistant, isolating agent sessions and adding read-only canvas tabs brings the measured bundle to approximately 534 kB initial / 564.5 kB total gzip; this adds another 20 KiB to each limit. Chromium/WebKit scenarios exercise background targeting, manual-write conflicts, idle following, palette ownership, read-only tabs and assistant continuation while browsing Home. The full Zod runtime is kept out of the browser bundle.

Missing build manifests/chunks and exceeded budgets fail the command. Unit tests exercise passing builds, oversized static imports, oversized workers, and missing files. To review a budget change, rebuild, inspect the measured growth and chunk split, then update the limits in the JSON file with the reason in the PR. The checker never updates limits automatically.

The 0.0.6 non-square pixels, export settings validation and `.aseprite` import diagnostics fit within those
existing budgets: measured 538,297 bytes initial / 569,769 bytes total gzip. The new
features did not require increasing the limits.

CI builds once, then runs `PIXPRITE_E2E_PREBUILT=1 bun run test:e2e:smoke` against that exact `dist/web` directory. Without this variable, browser tests retain their normal build-first behavior. To inspect another build/budget fixture, use `bun scripts/bundle-check.ts <build-directory> <budget-json>`.

The v5 model scenario imports a shared-image fixture through the file picker, checks exact transformed/effected PNG pixels in Chromium, then saves and reloads while verifying the original Image payload remains unchanged. Unit tests additionally cover copy-on-write bitmap mutations, resource references, migrations, tilemap rasterization, floating previews and undo.

The large-document scenario observes the standard Worker boundary in the production build: raw typed pixel arrays go to the real worker; its result delivery is held while real keyboard, timeline and pointer input changes the document. It checks the captured session revision, the later edit, matching project metadata/data, dirty markers and reload. It does not set a timing budget; see [background work](background-work.md) for fallback and main-thread capture limits.

The preceding budget change on 2026-10-31 accounted for all built-in UI/codecs shipping in one browser bundle. See [bundle loading](bundle-loading.md) for startup-animation, offline and file-handler regressions. Browser tests do not require Rust. See [desktop/MCP](desktop-mcp.md) for Tauri prerequisites and native checks.

The desktop workflow builds the Tauri executable/installers and runs `bun run test:native` plus `bun run test:desktop`. The native scenarios use the actual system WebView and embedded HTTP MCP. Test windows stay hidden and do not take focus; set `PIXPRITE_E2E_SHOW_WINDOWS=1` to show them for debugging. Scenarios that do not need MCP use `--no-mcp`, which overrides saved automatic startup without changing preferences. They cover documents, files, sessions, single-instance file forwarding, MCP flags and lifecycle, menu removal, authentication and background release notifications. `scripts/check-desktop-package.ts` validates prepared content and the native executable/resources before release artifacts are uploaded.

Optional WebKit regression checks: `bunx playwright install webkit`, then `bun run test:webview`. This covers editor round trips and the extension sandbox with WebKit alongside the native scenarios.

`e2e/package-history.e2e.ts` checks category/tag search, compatible version selection,
downgrades and offline restore. `e2e/ai-assistant.e2e.ts` uses a local mocked model
to cover TSX controls, queued prompts, real Extension API tool calls and stored chats.
`e2e/playback.e2e.ts` covers live seeks across tags, layer selection, scope changes,
and independent play-once/rewind settings. Security fixtures also check portable
backups, interrupted activation, disabled updates, invalid panel imports and unified
workspace migration. `scripts/extension-publication.test.ts` publishes only into a
temporary Git repository and checks history, tags and immutable version bytes.

`ExportSettings.test.ts` rejects malformed saved export options and stale targets.
`PixelRatio.test.ts` covers ratio normalization, invalid metadata, undo/redo, quarter-turns,
legacy import diagnostics and `.pixprite`/`.aseprite` round trips. Browser automation
checks actual pointer-to-pixel mapping and canvas/Preview proportions for `2:1`, `1:2`,
`4:5` and `8:7`, raw/baked PNG exports and matching sprite-sheet JSON dimensions.
Native MCP scenarios verify the saved `.aseprite` header and raw/baked PNG dimensions.
`AsepriteWarnings.test.ts` uses locally built binary chunks to check unsupported-data
diagnostics and their persistence through worker preparation and `.pixprite` saves.
`e2e/mcp-automation.e2e.ts` additionally checks independent successful export settings,
reload/library restoration, cancelled/failed native saves and completion after a tab switch.
Its save-dialog adapter is simulated; `e2e/desktop-mcp-editing.e2e.ts` verifies actual native
MCP writes cannot overwrite a lossy import's source even with `overwrite:true`.
`storage::tests::protected_exports_never_replace_existing_files_and_cleanup_temporary_data`
checks the filesystem primitive separately. The browser cannot observe completion of a
browser-managed download; the native bridge returns true only after a completed write.

Game rig physics checks cover zero coyote time, grace expiration, jump cut, air control,
fast swept collisions, refresh-rate stability and animation finish duration. Browser checks
exercise the real platformer TSX panel and native selection in shared number fields.
