# Browser benchmarks

Run from the repository root with Bun and Playwright's Chromium installed:

```sh
bunx playwright install chromium
bun run benchmark --smoke --samples 1 --warmups 0
bun run benchmark --full --samples 3 --warmups 1 --output dist/reports/benchmarks/candidate.json
bun benchmarks/compare.ts benchmarks/baseline.json dist/reports/benchmarks/candidate.json
```

`--full` is the default. `--smoke` runs frames-100, tileset-4096 and both drawing scenarios. `--samples N`, `--warmups N`, `--steps N` and `--headed` are supported. Full defaults are three retained samples, one discarded warmup per scenario, and 200 trusted pointer moves per stroke. To reduce percentile noise use at least 20 retained samples on an otherwise idle machine. Warmups exercise the same code in discarded fresh contexts: they warm browser/OS caches, not an already-open document's incremental cache.

The runner builds a separate optimized `dist/benchmarks`, serves it only on loopback, and opens a fresh browser context for every iteration. Shipping `dist/web` is untouched. It imports the actual React application, Sprite/DocumentModel, compute Worker and Projects IndexedDB implementation. No benchmark entry or fixtures are imported by the production entry. Raw JSON artifacts go to ignored `dist/reports/benchmarks/`; the checked-in [baseline.json](baseline.json) contains compact results from the measured full run, described in [BASELINE.md](BASELINE.md).

The full matrix is deliberately separated rather than taking a giant Cartesian product:

| Scenario | Fixture |
| --- | --- |
| frames-100 / 400 / 1000 | 32×32, one layer, unique immutable source per frame |
| layers-10 / 50 / 100 | 128×128, one frame, unique source per layer |
| image-2048 | 2048×2048 RGBA source |
| image-wide-4096 | 4096×256 source, exercising the maximum supported side |
| linked-50000 | 50 layers × 1000 frames, 50 sources and continuous aliases |
| tileset-4096 | 4096 tiles at 16×16, actual tilemap with tile references |
| long-stroke | Real pencil input, 256×256, 200 moves by default |
| drawing-autosave | Real pencil input, 1024×1024, four layers, real autosave Worker overlap |

Fixtures use a deterministic xorshift pixel sequence and stable image IDs. Every source side is ≤4096 and every document is below 67,108,864 source pixels. The largest source allocation is 2048² pixels; the benchmark does not allocate 1000 independent 4K frames.

Save, open and export timings run for every core fixture. Save includes incremental capture, background base64 preparation/validation/thumbnail, resource splitting and actual IndexedDB transaction completion. Benchmark-only instrumentation requests `durability: 'strict'` for read/write transactions, so this result includes the browser's strict commit semantics. Production's default durability is unchanged. Each sample starts with empty origin storage, so these are first-save measurements, not incremental resave timings. Open includes IndexedDB manifest/resource hydration, background decoding and facade hydration. Export includes raw capture, background rendering and PNG encoding of frame zero at scale one; download dialogs and disk file saving are outside the timer.

Every core sample checks all source checksums, metadata, tile references and continuous cel alias relationships after save/open, plus first/middle/last composite checksums. It decodes the exported PNG and compares its pixels with the live composite. The history workload performs 16 edits plus undo/redo; the tileset case uses metadata edits, preserving its original tilemap. Drawing scenarios verify that committed document pixels changed; the autosave case independently reloads the latest persisted document and checks its sources/links/pixels. Invalid workloads or missing real drawing Worker overlap fail the run. The overlap check accepts a trusted drawing pointerdown or pointermove, since the first down mutation may immediately cancel an obsolete Worker.

FPS counts actual editor canvas render loops divided by the measured `performance.now()` window. The autosave window includes the initial debounce/Worker wait. Input latency starts at a trusted Chromium pointer event's timestamp and ends in the microtask after the next real editor canvas loop, including the event handler, pencil brush, frame wait and composite/preview render. Multiple events can share a rendered frame. Separate `pointerDownLatencyMs`/`autosavePointerDownLatencyMs` arrays and down counts observe trusted pointerdown in capture phase before the first pencil mutation can cancel a Worker; they are a compatible schema-v1 extension and never enter the existing pointermove latency arrays/counts. Empty move-overlap summaries use null percentiles with an explicit reason rather than a substituted zero. This measures software event-to-render latency, excluding physical devices, OS input scheduling before the browser timestamp, display composition and scanout. It is not a desktop responsiveness claim. FPS is measured in the two interactive scenarios; the other fixtures have render-correctness checks and save/open/export timings, not timeline-scroll performance measurements.

Heap measurements use CDP `Runtime.getHeapUsage` after explicit GC before and after each workload. `usedSize`, `totalSize`, `embedderHeapUsedSize` and `backingStorageSize` are retained as reported; backing storage is reported separately rather than silently added to the JS heap. These values exclude Worker heaps, GPU/native allocations and process RSS. IndexedDB uses CDP `Storage.getUsageAndQuota` for the actual browser origin, with a fresh-context baseline and raw storage breakdown; its usage includes database overhead. Missing APIs yield `null` with a reason, never a substituted zero.

Undo diagnostics count existing unique ArrayBuffer backing stores retained only by history, including immutable image sources, already-materialized cel bitmaps, tilesets, tile references and selection masks. Shared live buffers are excluded. The read-only helper never invokes getters or materializes a bitmap. `metadataPayloadBytes` is a separately labelled deterministic estimate: UTF-8 property names/string values, eight-byte numbers and one-byte booleans. It is not an estimate of JS engine object headers, reference slots, interned-string storage, array capacity, WeakMaps or allocator overhead; use browser heap measurements for a broader view.

Raw artifacts record versions, source fingerprint, dirty checkout status, browser/GPU information, OS/CPU/RAM, fixture configuration, units, individual samples, Worker dispatch/completion intervals, correctness checks and sample counts. Statistics use nearest-rank p50/p95. With three samples p95 is simply the maximum. Compare matching hardware, Chromium, mode, steps, viewport, warmups and durability. The comparison script reports configuration differences and changes for matching measured metrics; it does not enforce timing gates. Headless Chromium often uses software rendering, so compare its baseline to another equivalent headless run, and collect a separate headed baseline for desktop conclusions.


## History memory regression checks

```sh
bun benchmarks/history-check.ts
```

This optimized browser-only entry checks trusted pencil input under both tiny total and operation budgets: Escape restores the original pixels, completed oversized edits remain visible and cannot be crossed by undo, and the History controls expose the limits and boundary. It exercises the actual extension transaction handlers, failure/deactivation rollback, equal-version onion tint ownership and version invalidation. Closing the final tab checks active-document, clipboard-source, playback, history/cache/palette and extension-transaction roots, then uses CDP GC and WeakRefs to verify that both the Sprite and an evicted snapshot are collectible. Raw results go to ignored `dist/reports/benchmarks/history/checks.json`; a failed GC check also writes a heap snapshot for retention-path diagnosis. No diagnostic API is added to the shipping build.

History limits apply to unique history-exclusive backing stores plus the documented metadata payload model above. Immutable sources, linked cels and all live/shared allocations are reused and charged once. Per-operation cost is the changed payload on both sides of an adjacent history transition, so allocating a large new image cannot bypass that limit. The oldest undo entries are removed first, then the farthest redo entries, preserving a contiguous reachable sequence. An oversized operation creates a boundary that undo cannot cross; the current document is kept. Even a single entry is removed if it exceeds the total budget. Limits of zero disable byte caps; the default remains 256 steps and uncapped bytes. Active strokes, floating selections and extension transactions temporarily protect rollback snapshots until commit/cancel/deactivation/close, then release them and apply the budgets. Object headers, engine/allocator overhead and GPU memory remain outside the payload budget; the accounting is not a hard browser heap or process-memory limit.

## Dragging, resize and native frame pacing

See [interface performance](../docs/interface-performance.md) for the native 60/120 Hz comparison, direct drag updates, repeatable commands and measurement limits. `interaction-check.ts` measures trusted browser drags; `native-interaction-check.ts` samples the actual installed WebView while resizing its window. Neither is imported by the shipping app.
