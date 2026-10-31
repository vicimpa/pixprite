# Interface frame pacing and dragging

The desktop wrapper requests the display cadence rather than WebKit's preference for updates near 60 fps. On macOS this uses the guarded `WKPreferences` feature `PreferPageRenderingUpdatesNear60FPSEnabled`. The feature and setter are checked at runtime; unsupported versions retain the platform default. The compatibility code is isolated in [`frame_pacing.rs`](../src-tauri/src/frame_pacing.rs). It uses WebKit SPI, not a public frame-rate API, and needs checking when upgrading WebKit/Tauri. The system still controls power-saving and actual presentation.

References: [WebKit preference definition](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml), [WebKit's frame-rate explanation](https://webkit.github.io/explainers/animation-frame-rate/).

The UI follows pointer samples directly while dragging. Dialogs and floating panels move using compositor transforms; splitters and panel edges update dimensions directly. React/document-layout state commits on release, cancellation or lost pointer capture. Settings writes settle after interaction; page exit and native close flush the latest editor preferences. Native size changes persist after 250 ms of quiet on a background worker, and moving the native window no longer writes settings or broadcasts redundant WebView state.

## Observed results

Measured on the built-in 120 Hz display, 1512×982 logical pixels, device scale 2, Apple Silicon, macOS 27.0.1. Native measurements used the actual focused Tauri WebView, a 64×64 document and isolated profiles. Cadence comes from all recorded rAF intervals, avoiding median rounding at WebKit's 1 ms timestamp precision.

| Native configuration | Idle rAF cadence | During native resize | Resize interval p95 |
| --- | ---: | ---: | ---: |
| Original implementation | 60.0 Hz | 60.2 Hz | 19 ms |
| Optimized UI, WebKit preference forced to 60 | 60.1 Hz | 60.0 Hz | 18 ms |
| Optimized UI, display cadence | 120.0 Hz | 120.0 Hz | 9 ms |

These measure software callbacks, not physical display scanout or end-to-end input latency. Samples are short diagnostic runs, not cross-device performance guarantees. Full intervals, focus/visibility and native request timings are saved in the raw artifacts. The native resize workload awaits each request and then waits 8 ms for two seconds; request counts can differ between configurations.

A separate headless Chromium run used 96 trusted mouse moves per interaction:

| Interaction | Original layout recalculations | After direct geometry updates |
| --- | ---: | ---: |
| Column splitter | 932 | 471 |
| Dialog drag | 101 | 8 |

During splitter movement, synchronous `pixprite:layout` writes dropped from 96 to zero; the final layout is persisted afterwards. Headless Chromium ran at its own cadence, so these counts are not evidence of 120 Hz presentation. Compare timings only with matching engines, foreground state and hardware.

## Reproduce

```sh
bun run build
bun run desktop:compile
PIXPRITE_WEBVIEW_FPS=60 bun benchmarks/native-interaction-check.ts prefer60
bun benchmarks/native-interaction-check.ts display
bun benchmarks/interaction-check.ts candidate
# Optionally use an actual browser window:
bun benchmarks/interaction-check.ts candidate --headed
```

Run native samples sequentially with the test window in front and no other native UI automation in progress. `PIXPRITE_WEBVIEW_FPS=60` is a diagnostic opt-out, not a global system setting. Other platforms keep their native WebView defaults. Scripts write only under `dist/reports/benchmarks/interaction/` and use temporary native profiles.

The local MCP tool `pixprite_performance` samples rAF cadence, pointer/resize activity and long tasks where supported. `durationMs` is bounded to 100–5000 ms; sampling stops automatically. It does not run a permanent FPS monitor. `desktop_info` reports the requested frame-pacing policy separately from measured cadence.

Regression checks cover live splitter geometry, deferred persistence, cancellation, dialog field rerenders, preview position, floating iframe retention and native size persistence:

```sh
bun run test:e2e e2e/interaction.e2e.ts e2e/responsive.e2e.ts
PIXPRITE_E2E_BROWSER=webkit bun run test:e2e e2e/interaction.e2e.ts
bun run test:desktop
```
