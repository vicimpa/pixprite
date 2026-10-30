# Tests

Install dependencies with `bun install --frozen-lockfile`.

- `bun test` / `bun run test`: document model, migration, malformed file and format round-trip tests. The network-dependent upstream Aseprite case is skipped by default.
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

`e2e/server.ts` is only a test server. Its loopback-only endpoints serve a tiny extension with per-file SHA-256 hashes and simulate a new Service Worker deployment. They are never included in the production build or deployed site. Browser tests use that local registry and require no external extension service.
