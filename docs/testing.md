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

`e2e/responsive.e2e.ts` checks the tool options, timeline actions and status strip at 800, 1024 and 1280 px with large Russian and English UI. It detects clipped controls as well as scrollbars, verifies the extra-tools palette, and exercises draft/preset retention when controls move into More, nested dropdowns and Escape during a pending transform.

Additional scenarios cover a renderer crash via Chromium CDP, session/snapshot restoration, offline reload, replacement of an active Service Worker, GIF export/reimport, extension installation/removal and permission denial, and storage failure/retry. Snapshot timing advances `Date` while leaving browser timers running normally. Quota tests inject an aborted IndexedDB write transaction with a `QuotaExceededError`; they do not fill the host disk. The Service Worker deployment fixture changes the worker revision while preserving application assets; mixed-version HTML/assets are a separate Service Worker test concern in the plan.

The storage controls scenario checks persistence status/request, the quota warning, project/snapshot sizes, ZIP and individual backups, and confirmed cleanup retaining the latest snapshot. Persistence API results and quota estimates are injected because browser policies vary. Unit storage tests use `fake-indexeddb` to verify legacy size reads, retention, archive payloads, and backup reminder state.

`e2e/server.ts` is only a test server. Its loopback-only endpoints serve a tiny extension with per-file SHA-256 hashes and simulate a new Service Worker deployment. They are never included in the production build or deployed site. Browser tests use that local registry and require no external extension service.

`e2e/home-icons.e2e.ts` checks Home text wrapping at 360–1024 px in Russian and English with large fonts. It checks the default Outline set, switches between both built-in sets offline, verifies constant icon dimensions and reload persistence, and preserves former pixel/outline preferences. It also installs the actual Duotone extension from an isolated catalog and checks live switching, disable/re-enable and removal fallback to Outline. Icon pack unit tests validate bounded inert artwork and coverage of the shipped sets.

`e2e/desktop-windows.e2e.ts` checks the compact app header, button placement, local tab ordering, removal of detached windows, window controls, close/reopen persistence and migration of old multi-window sessions into one window. Linux CI uses bare Xvfb, so actual minimize/maximize window-manager transitions are checked on macOS/Windows.

## CI and bundle budgets

Every pull request runs the main CI workflow, including documentation and extension changes. It installs dependencies with a frozen lockfile and Bun 1.4.2, then runs typecheck, unit tests, format round-trips, migrations, translations, extension checks, production build, bundle budgets, and Chromium smoke tests. PR checks use a read-only repository token. Successful pushes to `main` deploy the checked build artifact to `gh-pages` in a separate job with write permission. Browser failures retain traces/screenshots for seven days.

`bun run build && bun run bundle:check` checks the production JavaScript using gzip level 9. The Vite manifest identifies entry points and their static imports; each file is counted once. The total also includes the self-contained workers and Service Worker. The browser UI and codecs share one entry bundle. CSS, fonts, images and JSON are outside these JavaScript budgets.

Budgets in `scripts/bundle-budgets.json` are measured in bytes:

| Metric | Baseline | Limit |
| --- | ---: | ---: |
| Initial JavaScript gzip | ~372,000 | 389,120 (380 KiB) |
| Total JavaScript gzip | ~399,000 | 409,600 (400 KiB) |

Missing build manifests/chunks and exceeded budgets fail the command. Unit tests exercise passing builds, oversized static imports, oversized workers, and missing files. To review a budget change, rebuild, inspect the measured growth and chunk split, then update the limits in the JSON file with the reason in the PR. The checker never updates limits automatically.

CI builds once, then runs `PIXPRITE_E2E_PREBUILT=1 bun run test:e2e:smoke` against that exact `dist/web` directory. Without this variable, browser tests retain their normal build-first behavior. To inspect another build/budget fixture, use `bun scripts/bundle-check.ts <build-directory> <budget-json>`.

The v5 model scenario imports a shared-image fixture through the file picker, checks exact transformed/effected PNG pixels in Chromium, then saves and reloads while verifying the original Image payload remains unchanged. Unit tests additionally cover copy-on-write bitmap mutations, resource references, migrations, tilemap rasterization, floating previews and undo.

The large-document scenario observes the standard Worker boundary in the production build: raw typed pixel arrays go to the real worker; its result delivery is held while real keyboard, timeline and pointer input changes the document. It checks the captured session revision, the later edit, matching project metadata/data, dirty markers and reload. It does not set a timing budget; see [background work](background-work.md) for fallback and main-thread capture limits.

The initial budget was raised on 2026-10-31 because all built-in UI/codecs now ship in one browser bundle; the total budget is unchanged. See [bundle loading](bundle-loading.md) for startup-animation, offline and file-handler regressions. Browser tests do not require Rust. See [desktop/MCP](desktop-mcp.md) for Tauri prerequisites and native checks.

The desktop workflow builds the Tauri executable/installers and runs `bun run test:native` plus `bun run test:desktop`. The native scenarios use the actual system WebView and standalone stdio MCP. They cover documents, files, sessions, menu removal, authentication and background release notifications. `scripts/check-desktop-package.ts` validates prepared content and the native executable/resources before release artifacts are uploaded.

Optional WebKit regression checks: `bunx playwright install webkit`, then `bun run test:webview`. This covers editor round trips and the extension sandbox with WebKit alongside the native scenarios.
