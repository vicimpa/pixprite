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

Playwright builds the application and serves `dist` on `127.0.0.1:4173`. Stop any existing server on that port first. Tests use Chromium, English interface text, a fixed desktop viewport, isolated browser contexts, and one worker. Failed runs retain a screenshot and trace in `test-results`; open a trace with `bunx playwright show-trace <path-to-trace.zip>`.

The suite performs real pointer drawing, command palette actions, file selection/download, tab navigation, and page reloads. Browser IndexedDB reads verify the saved documents; PNG comparisons decode the browser's exported image. The production application has no test API.

Additional scenarios cover a renderer crash via Chromium CDP, session/snapshot restoration, offline reload, replacement of an active Service Worker, GIF export/reimport, extension installation/removal and permission denial, and storage failure/retry. Snapshot timing advances `Date` while leaving browser timers running normally. Quota tests inject an aborted IndexedDB write transaction with a `QuotaExceededError`; they do not fill the host disk. The Service Worker deployment fixture changes the worker revision while preserving application assets; mixed-version HTML/assets are a separate Service Worker test concern in the plan.

The storage controls scenario checks persistence status/request, the quota warning, project/snapshot sizes, ZIP and individual backups, and confirmed cleanup retaining the latest snapshot. Persistence API results and quota estimates are injected because browser policies vary. Unit storage tests use `fake-indexeddb` to verify legacy size reads, retention, archive payloads, and backup reminder state.

`e2e/server.ts` is only a test server. Its loopback-only endpoints serve a tiny extension with per-file SHA-256 hashes and simulate a new Service Worker deployment. They are never included in the production build or deployed site. Browser tests use that local registry and require no external extension service.

## CI and bundle budgets

Every pull request runs the main CI workflow, including documentation and extension changes. It installs dependencies with a frozen lockfile and Bun 1.4.2, then runs typecheck, unit tests, format round-trips, migrations, translations, extension checks, production build, bundle budgets, and Chromium smoke tests. PR checks use a read-only repository token. Successful pushes to `main` deploy the checked build artifact to `gh-pages` in a separate job with write permission. Browser failures retain traces/screenshots for seven days.

`bun run build && bun run bundle:check` checks the production JavaScript using gzip level 9. The Vite manifest identifies entry points and their static imports; each file is counted once. The total also includes lazy chunks, workers, and other emitted JavaScript. CSS, fonts, images and JSON are outside these JavaScript budgets.

Budgets in `scripts/bundle-budgets.json` are measured in bytes:

| Metric | Baseline | Limit |
| --- | ---: | ---: |
| Initial JavaScript gzip | 266,405 | 307,200 (300 KiB) |
| Total JavaScript gzip | 356,072 | 409,600 (400 KiB) |

Missing build manifests/chunks and exceeded budgets fail the command. Unit tests exercise passing builds, oversized static imports, oversized workers, and missing files. To review a budget change, rebuild, inspect the measured growth and chunk split, then update the limits in the JSON file with the reason in the PR. The checker never updates limits automatically.

CI builds once, then runs `PIXPRITE_E2E_PREBUILT=1 bun run test:e2e:smoke` against that exact `dist` directory. Without this variable, browser tests retain their normal build-first behavior. To inspect another build/budget fixture, use `bun scripts/bundle-check.ts <build-directory> <budget-json>`.

The v5 model scenario imports a shared-image fixture through the file picker, checks exact transformed/effected PNG pixels in Chromium, then saves and reloads while verifying the original Image payload remains unchanged. Unit tests additionally cover copy-on-write bitmap mutations, resource references, migrations, tilemap rasterization, floating previews and undo.
