# Development

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md) · [Tests](testing.md)

## Start here

Use Bun **1.4.2**, matching CI, and **Node.js 24+** for the standalone MCP launcher. Desktop builds additionally require Rust from `rust-toolchain.toml` and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
bun install --frozen-lockfile
bun run dev
```

The editor runs at `http://localhost:3355`. `bun run ext:dev` starts a separate extension catalog on port 5174 for local extension development; see the [extension guide](extensions/README.md).

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | Document state, tools, commands, history, storage, formats and compute workers |
| `src/core/extensions/` | Extension lifecycle, permissions, sandbox and API implementation |
| `src/modules/` | Editor workspace, Home, timeline, menus and dialogs |
| `src/ui/` | Shared controls and layout components |
| `src/styles/`, `src/locales/` | Themes, global styles and interface translations |
| `src-tauri/` | Rust/Tauri shell, native files, window, dialogs and release checks |
| `desktop/` | Limited JS bridge, storage migration and external stdio MCP |
| `packages/api/` | Public extension API types and helpers |
| `extensions/<id>/` | Extension manifests, source, locales and assets |
| `public/` | Static assets copied into the web build |
| `scripts/` | Build/release tools, extension validation and bundle checks |
| `e2e/` | Playwright scenarios and isolated loopback fixtures |
| `benchmarks/` | Separate optimized performance/diagnostic entries and recorded baseline |
| `docs/` | Guides, architecture notes, release notes, roadmap and documentation assets |
| `.github/` | CI, deployment, release workflows and contribution templates |

Browser imports use `~/` for `src/`. Extensions import `@pixprite/api`. Each TypeScript project has its own `tsconfig.json`; the root solution checks all of them with `tsc -b`.

The renderer talks to Rust/Tauri through a limited initialization bridge. Native operations belong in `src-tauri/`; Node.js runs only the external stdio MCP adapter. The [sprite architecture](sprite-architecture.md) describes the document/resource boundary.

## Generated files

All build output and reports belong under the ignored `dist/` directory:

```text
dist/
├── web/                Browser app, static assets and Service Worker
├── desktop/            Native executable, prepared content and MCP launcher
├── tauri/              Cargo output and platform application bundles
├── installers/         Native packages
├── benchmarks/         Optimized performance fixtures
├── security/           Optimized extension-security fixture
└── reports/
    ├── e2e/            Failure traces and screenshots
    ├── playwright/     CI HTML report
    ├── benchmarks/     Raw measurements, snapshots and diagnostic images
    └── screenshots/    Local UI captures
```

The web build clears only `dist/web/`; desktop compilation clears only `dist/desktop/`. Other outputs are preserved. Do not deploy the entire `dist/` tree: **only `dist/web/` is the website**. Compiler caches live under `node_modules/.tmp/`.

Older checkouts used `desktop-dist/`, `release/`, `.benchmark-dist`, `.extension-dist`, `benchmark-results/`, `test-results/` and `playwright-report/` at the repository root. Their replacements are listed above; old local artifacts can be moved into the corresponding directory.

## Commands

| Command | Result |
| --- | --- |
| `bun run dev` | Browser development server, port 3355 |
| `bun run build` | Typecheck and production web build in `dist/web/` |
| `bun run preview` | Serve the production web build |
| `bun run desktop:dev` | Build the web/native entries and launch Tauri |
| `bun run desktop:compile` | Compile debug executable and bridge; requires an existing web build |
| `bun run desktop:pack` | Build a release executable without an installer |
| `bun run desktop:build` | Build native installers for the current OS |
| `bun run mcp` | Start the stdio launcher in `dist/desktop/`; connect a client via [MCP setup](desktop-mcp.md) |
| `bun run typecheck` | Check all TypeScript projects |
| `bun test` | Unit tests |
| `bun run i18n:check` | Validate interface translations |
| `bun run ext:check` | Validate extension packages |
| `bun run bundle:check` | Inspect the existing web build and enforce JavaScript budgets |
| `bun run test:e2e:smoke` | Build and run the short browser scenarios |
| `bun run test:desktop` | Run real native WebView and MCP scenarios |
| `bun run test:native` | Run Rust release-check/storage tests |
| `bun run test:e2e` | Build and run browser scenarios |
| `bun run benchmark --smoke` | Build and run the smaller performance matrix |

Install Chromium once with `bunx playwright install chromium`. On Linux, the native scenarios also need a display; CI uses `xvfb-run`. Set `PIXPRITE_E2E_PREBUILT=1` to reuse the existing web build during Playwright runs. See [testing](testing.md) for coverage and artifacts.

## Delivery

The main CI workflow validates changes and deploys `dist/web/` from successful pushes to `main` to GitHub Pages. The desktop workflow builds macOS, Windows and Linux packages, and publishes tagged releases with MCP and checksums. The separate extensions workflow publishes catalog sources. Workflow definitions live in [`.github/workflows/`](../.github/workflows/).

Before a release, update `package.json` and the package version in `src-tauri/Cargo.toml`, then add `docs/releases/v<version>.md`. The desktop release workflow checks that the tag matches the package version. The release-notification behavior is documented in [desktop and MCP](desktop-mcp.md).

## Documentation images

The README shows the real editor with the original layered [Midnight beacon example](assets/beacon.pixprite), distributed under the repository's MIT license. Open the file in Pixprite to inspect the layers and eight-frame loop.

To refresh the screenshot after UI changes:

```sh
bun run build
bunx playwright install chromium
bun run docs:screenshot
```

The capture uses a temporary loopback server and an isolated Chromium profile, imports the example through the editor's file picker and writes `docs/assets/editor.png`.
