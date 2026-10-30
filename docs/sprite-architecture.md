# Sprite modules

`src/core/Sprite.ts` keeps the editor's existing document API, reactive fields,
and core pixel/canvas operations. Its operation methods delegate to these modules:

| Module | Responsibility |
| --- | --- |
| `SpriteHistory` | Snapshot capture/restore, undo/redo, history limits |
| `SpriteSerialization` | `.pixprite` encoding/loading, Aseprite document conversion, image/sheet import |
| `SpriteRenderer` | Layer/group compositing, clipping, render caches |
| `LayerOperations` | Layer/group creation, ordering, merging, backgrounds |
| `FrameOperations` | Frames, timeline ranges, linked cels, tags and timing |
| `SelectionOperations` | Masks, floating selections, selection transforms and clipboard |
| `TileOperations` | Tilemap editing, tileset remapping and conversion |
| `SpriteValidation` | Version migration, input validation and document integrity |

`SpriteModel` contains shared types and pure model helpers. Existing imports from
`~/core/Sprite` remain valid through re-exports. `DocumentModel` adds shared Image resources,
placed CelInstance values, AssetRef descriptors and the common bake pipeline.
The current `.pixprite` writer uses v6; readers migrate v3/v4/v5 explicitly. v6 adds the per-frame residual Layer FX scope; v5 shared-image resources retain their schema.

Operations receive the same `Sprite` instance as their typed `this` value. The
internal `SpriteContext` describes its public interface and the private state that
operations share. A single cast inside `Sprite.operationContext` bridges this
internal boundary; fields remain private on the public class. Context references
to `Sprite` are type-only, so collaborators do not import the facade at runtime.

Reactive decorators stay on `Sprite`, whose construction and instance identity
remain unchanged. Existing linked-image, undo/redo, validation, round-trip,
rendering and browser tests cover the extracted behavior.

## Resource and instance boundary

`createImage` copies its input and exposes a defensive public pixel view. Multiple
`createCelInstance` values share that immutable Image, with independent positions,
reflections, clockwise quarter turns and opacity. An instance still exposes the
legacy `{x, y, w, h, data}` bitmap shape, so existing drawing and selection code
reads the rendered placement. Resource/transform descriptors are non-enumerable:
a spread followed by new pixel data produces a baked value, never a stale source
reference. Ordinary pixel edits replace the affected instance while continuous
aliases still intentionally change together.

The instance's bitmap is private. Legacy direct index, `.set`, and ArrayBuffer
writes cannot alter a sibling/source; before serialization or source reuse, an
exact comparison detects those writes and detaches that instance to a new Image.
Callers still use Sprite mutation/checkpoint methods for undo and invalidation.
`imageOf` also accepts old plain cel objects, preserving their existing identities
and data-buffer semantics. Loading v5/v6 constructs canonical instances, sharing one
Image object for each stable ID. Shared sources do not imply linked timeline cels.

`Sprite.setCelTransform` and `setLayerEffects` create undoable immutable updates.
`LayerFX` currently includes an opacity processor; the broader effects interface
belongs to P2. Floating pixels are composited before the layer effect stack, and
destructive merges clear already-baked effects. `bakeCel` feeds both rendering and
Aseprite conversion; all raster exports already use the renderer. Indexed exports
with newly baked instance/effect alpha promote to RGB to retain that alpha; the
editable document retains its indexed mode. See
[pixprite-format.md](pixprite-format.md) for migration and export details.
