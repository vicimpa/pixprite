# Measured baseline

Collected 2026-10-30T19:30:41.905Z with `bun run benchmark --full --samples 3 --warmups 1 --output benchmark-results/full-baseline.json`.

Status: **complete**, 12 scenarios, 36 retained samples and 12 discarded warmups. Bun 1.4.2, Playwright 1.64.1, Chromium 156.0.8078.4; headless, software 2D canvas and SwiftShader. Runner host: Apple M4 Pro, 12 logical CPUs, 24 GiB RAM, darwin 27.0.0. Viewport 1440×1000, scale factor 1. These numbers describe this headless run, not desktop hardware performance.

Base commit `6a787e679e31` plus the benchmark changes in the dirty checkout; source fingerprint `6cd8f8bc3767a21f22f420e25d03fc6b698f3a637661d0ebb86550dd7373fe55`. The [compact JSON](baseline.json) preserves environment, configuration, units, statistics, correctness and autosave evidence. Raw per-sample results are now stored in ignored `dist/reports/benchmarks/full-baseline.json`; the historical commands below retain their original output paths.

Times below are **p50 / p95 in ms**, three retained samples per fixture (nearest-rank p95 is the maximum). PNG is frame zero at scale one. Each save includes strict IndexedDB commit and background preparation; each open includes background decoding.

| Fixture | Save | Open | PNG export |
| --- | ---: | ---: | ---: |
| frames-100 | 35.6 / 44.1 | 13.6 / 14.6 | 5.3 / 5.5 |
| frames-400 | 90.7 / 92.1 | 27.0 / 27.1 | 7.8 / 7.9 |
| frames-1000 | 248.7 / 252.4 | 86.2 / 92.3 | 17.8 / 23.9 |
| layers-10 | 54.3 / 67.9 | 15.6 / 25.0 | 17.5 / 28.6 |
| layers-50 | 140.0 / 147.8 | 25.8 / 26.7 | 33.5 / 35.0 |
| layers-100 | 254.4 / 258.7 | 44.9 / 47.1 | 54.3 / 56.2 |
| image-2048 | 524.0 / 527.3 | 82.8 / 86.0 | 147.9 / 152.3 |
| image-wide-4096 | 148.0 / 149.3 | 28.2 / 29.4 | 43.0 / 43.2 |
| linked-50000 | 181.6 / 185.6 | 102.1 / 103.3 | 32.5 / 32.6 |
| tileset-4096 | 145.7 / 150.0 | 35.2 / 36.0 | 12.9 / 13.5 |

Memory/storage below are median MiB, measured after the history workload and GC. IndexedDB delta is relative to the fresh-context baseline; the database itself starts with about 0.14 MiB of schema/storage overhead. JS heap and V8 backing storage are separate reported quantities. Undo buffer bytes count unique existing backing stores retained only by history; metadata is a separately specified payload estimate, not JS engine allocation size.

| Fixture | JS heap | Backing storage | IndexedDB | IDB delta | Undo buffers | Undo metadata |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frames-100 | 5.51 | 1.84 | 0.77 | 0.63 | 0.07 | 0.052 |
| frames-400 | 5.99 | 3.01 | 2.64 | 2.50 | 0.07 | 0.203 |
| frames-1000 | 6.95 | 5.35 | 6.37 | 6.23 | 0.07 | 0.505 |
| layers-10 | 5.40 | 3.62 | 1.07 | 0.93 | 1.06 | 0.031 |
| layers-50 | 5.54 | 8.62 | 4.43 | 4.29 | 1.06 | 0.140 |
| layers-100 | 5.81 | 14.87 | 8.65 | 8.51 | 1.06 | 0.276 |
| image-2048 | 5.31 | 289.37 | 21.58 | 21.44 | 272.00 | 0.007 |
| image-wide-4096 | 5.30 | 73.37 | 5.49 | 5.35 | 68.00 | 0.007 |
| linked-50000 | 12.35 | 1.83 | 0.49 | 0.35 | 0.07 | 10.934 |
| tileset-4096 | 5.93 | 5.87 | 5.90 | 5.76 | 0.00 | 0.006 |
| long-stroke | 7.18 | 2.62 | 0.14 | — | 0.50 | 0.001 |
| drawing-autosave | 34.13 | 65.37 | 21.55 | — | 8.00 | 0.001 |

The 2048² fixture retains 272 MiB of actual undo buffers after 16 pixel edits. The tileset fixture performs 16 metadata edits, so its measured history-exclusive buffer count is zero while metadata remains retained. Worker heaps, native/GPU memory, process RSS, and engine object/allocator overhead are outside these numbers.

| Interactive fixture | FPS p50 / p95 | Input latency p50 / p95, ms | Trusted rendered events |
| --- | ---: | ---: | ---: |
| long-stroke | 60.1 / 60.3 | 14.5 / 16.0 | 600 |
| drawing-autosave | 55.2 / 55.9 | 15.1 / 48.9 | 600 |

FPS uses actual canvas render loops over the measured window. Latency is trusted pointer timestamp to the end of the next actual editor canvas render task, including pencil/event/frame/render work. It excludes physical input and display presentation. All three autosave samples had 200/200 pointer moves overlap an active, unmodified prepare Worker; final persisted document resources, links and pixels matched the completed visible stroke. Autosave sample input p95 ranged from 20.9 to 55.3 ms, so the three-sample tail is noisy. This run is a comparison baseline, not a timing gate.

All 30 core samples passed complete source/metadata/tile-reference/alias round trips, first/middle/last composite checksums, and decoded PNG pixel checks. All six interactive samples changed visible committed pixels. Full raw timing samples and Worker intervals are in the local artifact; the compact artifact preserves representative deterministic checksums.

## Autosave finding

A continuous stroke can trigger repeated background preparation while it is still in progress. The measured autosave samples dispatched 15, 15, 16 real `prepareDocument` tasks respectively. `View.onPointerUp` calls `state.save()` when the stroke finishes; pointer moves change the document version without calling that cancellation/debounce entry. When an in-flight preparation finishes with an outdated version, `State.persistEditors` requests another pass. The original debounce deadline has already expired, so the next preparation starts immediately. This explains the sustained Worker overlap observed in the artifact. The benchmark block records this behavior and leaves the persistence implementation for a separate change.

See [README.md](README.md) for all measurement boundaries, full fixture matrix, rerun and comparison commands.

## Autosave quiet-period fix follow-up

The historical tables and checked-in `baseline.json` above remain unchanged. A follow-up run used `bun run benchmark --smoke --samples 3 --warmups 1 --steps 200 --output benchmark-results/autosave-quiet-fix.json` (local ignored [raw artifact](../dist/reports/benchmarks/autosave-quiet-fix.json)): two core fixtures and both input fixtures, 12 retained samples plus four discarded warmups. Its input step count, sample/warmup counts, viewport and strict durability match the full baseline; the core matrix is the smoke subset.

All three retained drawing-autosave samples dispatched **2, 2, 2** real prepare tasks: one obsolete task terminated at the initial pencil mutation and one final task completed after quiet. Every sample rendered all 200 trusted pointer moves and independently reloaded the exact latest pixels/links. The pending-flush observer now watches actual version mutations through the quiet wait; it does not rely on pointerup calling `state.save()`.

Pencil paints its first pixel on trusted pointerdown. Immediate cancellation therefore leaves **0 pointermove-overlap samples and 1 pointerdown-overlap sample** in each autosave iteration. Benchmark instrumentation adds separate `trustedPointerDowns`, `renderedPointerDownSamples`, `pointerDownLatencyMs` and `autosavePointerDownLatencyMs` fields (and their summaries) as a compatible schema-v1 extension. Pointerdown is observed in capture phase before React handles the first mutation. Existing pointermove latency arrays/counts and FPS definitions are unchanged; down values are never mixed into them. Empty move-overlap summaries have `n: 0` and null percentiles, with an explicit per-sample reason. The overlap correctness check requires a real drawing down or move to overlap a real Worker, so cancellation does not remove the verified workload. Production E2E separately proves that down cancels before the first move and that 200 subsequent moves do not restart/copy preparation.

This three-sample follow-up establishes bounded preparation and pixel correctness. It does not establish an FPS or latency improvement; use a larger equivalent run for such claims.
