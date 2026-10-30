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
`~/core/Sprite` remain valid through re-exports. There is no format-version change.

Operations receive the same `Sprite` instance as their typed `this` value. The
internal `SpriteContext` describes its public interface and the private state that
operations share. A single cast inside `Sprite.operationContext` bridges this
internal boundary; fields remain private on the public class. Context references
to `Sprite` are type-only, so collaborators do not import the facade at runtime.

Reactive decorators stay on `Sprite`, whose construction and instance identity
remain unchanged. Existing linked-image, undo/redo, validation, round-trip,
rendering and browser tests cover the extracted behavior.
