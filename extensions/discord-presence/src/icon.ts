/**
 * Original 16×16 artwork of the extension: a pixel-art "P" badge with a presence dot.
 * The panel draws it on a canvas (the sandbox cannot load package files); `assets/icon.svg`
 * and `assets/icon.png` are rendered from this same grid.
 */

export const ICON_SIZE = 16;

export const ICON_COLORS: Record<string, string> = {
  '#': '#16131c', // outline
  s: '#2e2839',   // surface
  a: '#f0b24a',   // accent (P)
  g: '#4cd964',   // online dot
};

export const ICON_ART = [
  '................',
  '...##########...',
  '..#ssssssssss#..',
  '..#sssaaaaass#..',
  '..#sssaassass#..',
  '..#sssaassass#..',
  '..#sssaassass#..',
  '..#sssaaaaass#..',
  '..#sssaasssss#..',
  '..#sssaasssss#..',
  '..#sssaasssss#..',
  '..#sssaasss####.',
  '..##########gg#.',
  '...........#gg#.',
  '...........####.',
  '................',
];

/** Paints the artwork scaled by whole pixels; no smoothing, transparent background */
export function drawIcon(canvas: HTMLCanvasElement, size = 256) {
  const scale = Math.max(1, Math.floor(size / ICON_SIZE));
  canvas.width = ICON_SIZE * scale;
  canvas.height = ICON_SIZE * scale;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  for (let y = 0; y < ICON_ART.length; y++) {
    const row = ICON_ART[y];
    for (let x = 0; x < row.length; x++) {
      const color = ICON_COLORS[row[x]];
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
