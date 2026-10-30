# Non-destructive Outline

Open **Layer → Layer FX…** (or timeline **FX**) and choose **Add outline**, or **Add inner outline** for the inside preset. Set the RGB color, alpha byte (0–255), integer thickness (1–128), position and corners. Preview, animation, enable/disable, reorder, Apply/Cancel and frame/range/layer baking use the existing ordered stack. Close the dialog to draw or erase; the outline follows the new source silhouette immediately, including undo/redo. Applying an effect never changes Image resources or CelInstance transforms. Bake creates new resources in one undo step.

## Pixel geometry

Every processor sees the previous processor's RGBA pixels. Instance flips, quarter turns and instance opacity happen first. A pixel belongs to the silhouette exactly when its alpha is greater than zero. Hidden RGB in alpha-zero pixels is ignored. There is no antialiasing or fractional coverage. Holes and transparent space outside the source rectangle are part of the same transparent background.

For thickness `t`, the inward and outward radii are:

| Position | Inward | Outward |
| --- | --- | --- |
| inside | t | 0 |
| center | floor(t / 2) | ceil(t / 2) |
| outside | 0 | t |

An odd center thickness puts the extra pixel outside; center thickness 1 is therefore identical to outside thickness 1. Radii measure distances between integer pixel centers. A transparent pixel receives outline color when its distance to the nearest original nontransparent pixel is at most the outward radius. An original nontransparent pixel is recolored when its distance to the nearest original transparent pixel (including exterior space) is at most the inward radius. These two masks are calculated from the original silhouette for this processor; coloring one mask cannot seed the other.

Corners select the distance metric, for both inward and outward masks:

| UI | Stored `join` | Distance |
| --- | --- | --- |
| Round / обычные | round | sqrt(dx² + dy²), a disk |
| Miter / заострённые | miter | max(abs(dx), abs(dy)), a square |
| Bevel / срезанные | bevel | abs(dx) + abs(dy), a diamond |

These are pixel morphology kernels, without vector path fitting or a miter limit. For one red pixel and blue outside thickness 3, the exact footprints are:

```text
Round    Miter    Bevel
...B...  BBBBBBB  ...B...
.BBBBB.  BBBBBBB  ..BBB..
.BBBBB.  BBBBBBB  .BBBBB.
BBBRBBB  BBBRBBB  BBBRBBB
.BBBBB.  BBBBBBB  .BBBBB.
.BBBBB.  BBBBBBB  ..BBB..
...B...  BBBBBBB  ...B...
```

Outside pixels receive the configured RGBA directly. Existing nontransparent pixels keep their original alpha, including partially transparent edges. Inside recoloring uses source-atop: each RGB channel is `round(outlineChannel * outlineAlpha / 255 + sourceChannel * (1 - outlineAlpha / 255))`; source alpha stays unchanged. Alpha-zero outline colors are an identity operation. An entirely transparent image stays transparent.

Outward processing adds transparent margins, shifts the cel's top-left by `(-outward, -outward)` and grows both dimensions by twice that radius. Pixels beyond the document canvas remain available for baking and Aseprite; final image exports crop to the export rectangle. An off-canvas source can cast an outline onto the canvas. Groups isolate their complete content before applying their stack, including child effects, nested groups and off-canvas pixels. Layer/group opacity, blend and clipping apply afterward. Pixel selection masks do not limit a layer effect or its bake. Tilemaps, linked cels and transformed instances use the same pixel pipeline; immutable resources stay shared until painting or baking requires a new result.

## Ordering and exports

`Opacity → Outline` reduces source alpha before computing a new outline with its own alpha. `Outline → Opacity` reduces both source and outline alpha. Several outlines can grow/recolor each other's results. Consecutive opacity processors (ignoring disabled entries and alpha-zero identity outlines) retain the historical product-then-round behavior; a live Outline separates those runs. Reordering or editing an effect already baked into a frame does not reapply it there. New IDs still affect baked frames.

PNG, GIF, sprite sheets and video use the shared live renderer in Workers and fallback preparation. GIF retains its existing palette and binary-transparency limits. Aseprite receives baked cels and flattened group composites in the export copy; the original stack remains editable. Enabled outlines with nonzero alpha conservatively promote indexed bake/Aseprite export to RGB so custom colors and alpha survive. These outlines also promote grayscale bake/Aseprite export to RGB; opacity-only grayscale stays grayscale. Tilemap FX exports become raster layers. Other document frames and source tilesets remain editable under the existing bake-scope rules.

## Bounds and performance

Every processor's conservative rectangle, including transparent margins and cumulative outward growth, must fit within 4096 pixels on each side and 16,777,216 pixels total. Explicit preview/Apply and manual Bake validate before output allocation or mutation; the dialog explains refusal. Group checks include the full union of descendants and floating content, so distant cels cannot cause enormous allocations. Fixing or disabling one stack remains possible when unrelated stacks are paused.

Later source edits, resize, movement or floating transforms can exceed this limit. The affected stack is then **temporarily bypassed** and the canvas shows a localized **Layer FX paused** alert, even when ordinary tool hints are hidden. Dependent group stacks can also pause. Source pixels and enabled stack settings are retained; saving/autosave/loading preserves this state. Reducing geometry or thickness, disabling the offending effect, or undoing the edit automatically restores processing. Live preview and PNG/GIF/video exports show the same bounded fallback. Explicit Bake and Aseprite export refuse oversized states instead of silently dropping editable effects. A distant floating union is composited into the destination window during fallback, without allocating the unbounded union.

The algorithm uses exact separable squared Euclidean distance transforms for round corners, and two-pass distance transforms for miter/bevel. Time and scratch memory are linear in the bounded output area, independent of thickness squared. These pixel rules intentionally favor deterministic sprite geometry over vector-like joins.
