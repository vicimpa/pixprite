/**
 * Windows icon (.ico) and cursor (.cur) files. Every image is stored as an embedded PNG,
 * which the format allows for any size (sizes up to 256×256).
 */
export type IcoImage = { width: number; height: number; png: Uint8Array; };

export function encodeIco(images: IcoImage[], cursor?: { x: number; y: number; }) {
  const head = 6 + images.length * 16;
  const total = head + images.reduce((s, i) => s + i.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, cursor ? 2 : 1, true);
  v.setUint16(4, images.length, true);
  let offset = head;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    v.setUint8(e, img.width >= 256 ? 0 : img.width);
    v.setUint8(e + 1, img.height >= 256 ? 0 : img.height);
    v.setUint8(e + 2, 0);
    v.setUint8(e + 3, 0);
    if (cursor) {
      // Hot spot, scaled to this image's size
      v.setUint16(e + 4, Math.round(cursor.x * img.width), true);
      v.setUint16(e + 6, Math.round(cursor.y * img.height), true);
    } else {
      v.setUint16(e + 4, 1, true);
      v.setUint16(e + 6, 32, true);
    }
    v.setUint32(e + 8, img.png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}
