import type { StorageCapture } from './SpriteSerialization';
import type { Sprite } from './Sprite';
import type { PixpriteData } from './SpriteValidation';

type Entry = { encoded?: string; pixels?: Uint32Array; token: number };
const equal = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((value, i) => value === b[i]);
function fields(raw: any): any[] {
  return [...raw.images.map((image: any) => image.d), ...raw.tilesets.map((ts: any) => ts.d),
    ...raw.layers.flatMap((layer: any) => layer.cels.flatMap((cel: any) => cel?.t ? [cel.t] : []))];
}

/** Cache belongs to one live document. Immutable images are clean by identity; old mutable
 * tile buffers are compared with their captured copy, just as legacy cels are reconciled. */
export class IncrementalDocument {
  private entries = new WeakMap<object, Entry>();
  private nextToken = 0;
  private previewKey = '';
  private thumb = '';

  capture(doc: Pick<Sprite, 'captureStorageDocument'>, preview: boolean) {
    const pending = new WeakMap<Uint32Array, { owner: object; entry: Entry }>();
    const tokens = new Map<string | Uint32Array, number>();
    let dirtyResources = 0;
    const draft = doc.captureStorageDocument((owner, pixels, immutable) => {
      const previous = this.entries.get(owner);
      const current = immutable && previous ? undefined : pixels();
      if (previous?.encoded !== undefined && (immutable || previous.pixels && current && equal(previous.pixels, current))) {
        tokens.set(previous.encoded, previous.token);
        return previous.encoded;
      }
      const buffer = current!.slice(), entry = { pixels: immutable ? undefined : buffer, token: ++this.nextToken };
      pending.set(buffer, { owner, entry });
      tokens.set(buffer, entry.token);
      dirtyResources++;
      return buffer;
    });
    // Preview depends on rendering, rather than document title, info, tags or editor state.
    const visual = {
      width: draft.width, height: draft.height, colorMode: draft.colorMode, transparentIndex: draft.transparentIndex,
      images: draft.images.map(image => [image.id, image.w, image.h, tokens.get(image.d)]),
      tilesets: draft.tilesets.map(ts => ({ ...ts, name: undefined, userData: undefined, d: tokens.get(ts.d as string | Uint32Array) })),
      framePalettes: draft.framePalettes,
      layers: draft.layers.map(layer => ({ ...layer, name: undefined, locked: undefined, collapsed: undefined, userData: undefined,
        cels: layer.cels.map((cel: any) => cel && ({ ...cel, ext: undefined, t: cel.t ? tokens.get(cel.t) : undefined })) })),
    };
    const key = JSON.stringify(visual), needsPreview = preview && key !== this.previewKey;
    const raw = structuredClone(draft) as StorageCapture;
    const originals = fields(draft);
    return {
      raw, dirtyResources, preview: needsPreview,
      accept: (data: PixpriteData, thumb: string) => {
        const encoded = fields(data);
        originals.forEach((buffer, i) => {
          const ticket = typeof buffer === 'string' ? undefined : pending.get(buffer);
          if (ticket) this.entries.set(ticket.owner, { ...ticket.entry, encoded: encoded[i] });
        });
        if (needsPreview) { this.previewKey = key; this.thumb = thumb; }
        return needsPreview ? thumb : this.thumb;
      },
    };
  }
}
