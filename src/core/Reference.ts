import { pickFiles } from "~/core/Files";
import { t } from "~/core/i18n";
import type { Guide, Sprite } from "~/core/Sprite";
import { state } from "~/core/State";

/** Decoded reference images by data URL */
const images = new WeakMap<Sprite, Map<string, HTMLImageElement>>();
function documentImages() {
  let cache = images.get(state.sprite);
  if (!cache) images.set(state.sprite, cache = new Map());
  return cache;
}
export function clearReferenceCache(sprite: Sprite) { images.delete(sprite); }

/** The image of a reference layer, or null while it is still decoding */
export function referenceImage(src: string) {
  const cache = documentImages();
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Asks for an image and puts it on a new reference layer above the current one */
export async function openReference() {
  const [file] = await pickFiles('image/png,image/webp,image/jpeg,image/gif');
  if (!file) return;
  const src = await readDataUrl(file);
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => { });
  if (!img.naturalWidth) return state.showTip(t('msg.cantReadThisImage'));
  documentImages().set(src, img);
  state.sprite.addReferenceLayer(src, img.naturalWidth, img.naturalHeight, file.name.replace(/\.[^.]+$/, '') || 'Reference');
  state.save();
}

/** Adds a guide through the middle of the canvas (or at `pos`) */
export function addGuide(axis: 'x' | 'y', pos?: number) {
  const { sprite } = state;
  const p = pos ?? Math.floor((axis === 'x' ? sprite.width : sprite.height) / 2);
  setGuides([...state.guides, { axis, pos: p }], 'Add guide');
}

/** Replaces the document's guides as one undo step */
export function setGuides(list: Guide[], label = 'Move guide') {
  const { sprite } = state;
  sprite.checkpoint(label);
  sprite.guides = list;
  sprite.touch();
  state.save();
}

/** Puts guide `index` at an exact position */
export function moveGuide(index: number, pos: number) {
  const list = state.guides.slice();
  if (!list[index] || list[index].pos === pos) return;
  list[index] = { ...list[index], pos };
  setGuides(list);
}

export function clearGuides() {
  if (state.guides.length) setGuides([], 'Clear guides');
}
