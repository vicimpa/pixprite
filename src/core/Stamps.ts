/** Procedural stamp presets: named pixel masks that can be used as brushes */

/** A procedural stamp preset: a named pixel mask that can be used as a brush */
export interface StampPreset {
  /** Unique identifier */
  id: string;
  /** Translation key for the display name */
  nameKey: string;
  /** Pixel mask: 1 = opaque, 0 = transparent */
  mask: Uint8Array;
  /** Width in pixels */
  w: number;
  /** Height in pixels */
  h: number;
  /** Whether this is a built-in preset (vs user-created) */
  builtin: boolean;
}

/** Built-in stamp preset definitions */
export const BUILTIN_STAMPS: StampPreset[] = [
  createStarStamp(),
  createHeartStamp(),
  createSparkleStamp(),
  createDiamondStamp(),
  createCrossStamp(),
  createLeafStamp(),
];

/** Helper to create a mask from string rows ('.' = empty, '#' = filled) */
function maskFromRows(rows: string[]): StampPreset {
  const h = rows.length;
  const w = rows[0].length;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      if (x < row.length && row[x] === '#') {
        mask[y * w + x] = 1;
      }
    }
  }
  return { id: '', nameKey: '', mask, w, h, builtin: true };
}

/** Creates a clean 5-pointed star stamp (13x11) */
function createStarStamp(): StampPreset {
  const rows = [
    "......#......",
    "......#......",
    ".....###.....",
    "....#####....",
    "#############",
    ".###########.",
    "..#########..",
    ".###.###.###.",
    "###..###..###",
    "##....#....##",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.star';
  s.nameKey = 'stamp.star';
  return s;
}

/** Creates a clean heart stamp (15x13) */
function createHeartStamp(): StampPreset {
  const rows = [
    ".###.###.",
    "#########",
    "#########",
    "#########",
    ".#######.",
    "..#####..",
    "...###...",
    "....#....",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.heart';
  s.nameKey = 'stamp.heart';
  return s;
}

/** Creates a sparkle stamp (13x13) */
function createSparkleStamp(): StampPreset {
  const rows = [
    "......#......",
    "......#......",
    "....#####....",
    "...#######...",
    "..#########..",
    "#############",
    "..#########..",
    "...#######...",
    "....#####....",
    "......#......",
    "......#......",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.sparkle';
  s.nameKey = 'stamp.sparkle';
  return s;
}

/** Creates a diamond stamp (13x13) */
function createDiamondStamp(): StampPreset {
  const rows = [
    "......#......",
    ".....###.....",
    "....#####....",
    "...#######...",
    "..#########..",
    "#############",
    "..#########..",
    "...#######...",
    "....#####....",
    ".....###.....",
    "......#......",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.diamond';
  s.nameKey = 'stamp.diamond';
  return s;
}

/** Creates a cross/plus stamp (11x11) */
function createCrossStamp(): StampPreset {
  const rows = [
    "...###...",
    "...###...",
    "...###...",
    "#########",
    "#########",
    "#########",
    "...###...",
    "...###...",
    "...###...",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.cross';
  s.nameKey = 'stamp.cross';
  return s;
}

/** Creates a clean leaf stamp (13x15) */
function createLeafStamp(): StampPreset {
  const rows = [
    ".....#.....",
    "....###....",
    "...#####...",
    "..#######..",
    "..#######..",
    ".#########.",
    ".#########.",
    ".#########.",
    "..#######..",
    "..#######..",
    "...#####...",
    "....###....",
    ".....#.....",
    ".....#.....",
    ".....#.....",
  ];
  const s = maskFromRows(rows);
  s.id = 'stamp.leaf';
  s.nameKey = 'stamp.leaf';
  return s;
}

/** Gets a built-in stamp by ID */
export function getBuiltinStamp(id: string): StampPreset | undefined {
  return BUILTIN_STAMPS.find(s => s.id === id);
}

/** Creates a stamp preset from a custom brush bitmap */
export function createStampFromBrush(
  bmp: { w: number; h: number; data: Uint32Array },
  nameKey = 'stamp.custom'
): StampPreset {
  const mask = new Uint8Array(bmp.w * bmp.h);
  for (let i = 0; i < bmp.w * bmp.h; i++) {
    mask[i] = (bmp.data[i] >>> 24) > 0 ? 1 : 0;
  }
  return {
    id: `stamp.custom.${Date.now()}`,
    nameKey,
    mask,
    w: bmp.w,
    h: bmp.h,
    builtin: false,
  };
}

/** Rotates a stamp mask by the given angle (degrees) and returns new mask + dimensions */
export function rotateStampMask(
  mask: Uint8Array,
  w: number,
  h: number,
  angleDeg: number
): { mask: Uint8Array; w: number; h: number } {
  if (angleDeg % 360 === 0) return { mask, w, h };

  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Calculate new bounding box
  const corners = [
    [0, 0],
    [w - 1, 0],
    [w - 1, h - 1],
    [0, h - 1],
  ].map(([x, y]) => {
    const dx = x - (w - 1) / 2;
    const dy = y - (h - 1) / 2;
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  });

  const minX = Math.min(...corners.map(c => c[0]));
  const maxX = Math.max(...corners.map(c => c[0]));
  const minY = Math.min(...corners.map(c => c[1]));
  const maxY = Math.max(...corners.map(c => c[1]));

  const newW = Math.ceil(maxX - minX) + 1;
  const newH = Math.ceil(maxY - minY) + 1;
  const newMask = new Uint8Array(newW * newH);

  const newCx = (newW - 1) / 2;
  const newCy = (newH - 1) / 2;
  const oldCx = (w - 1) / 2;
  const oldCy = (h - 1) / 2;

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      // Inverse rotation
      const dx = x - newCx;
      const dy = y - newCy;
      const srcX = Math.round(oldCx + dx * cos + dy * sin);
      const srcY = Math.round(oldCy - dx * sin + dy * cos);

      if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
        newMask[y * newW + x] = mask[srcY * w + srcX];
      }
    }
  }

  return { mask: newMask, w: newW, h: newH };
}

/** Scales a stamp mask by the given factor (pressure-based scaling) */
export function scaleStampMask(
  mask: Uint8Array,
  w: number,
  h: number,
  factor: number
): { mask: Uint8Array; w: number; h: number } {
  if (factor <= 0) factor = 0.1;
  if (factor >= 2) factor = 2; // Clamp max scale

  const newW = Math.max(1, Math.round(w * factor));
  const newH = Math.max(1, Math.round(h * factor));
  const newMask = new Uint8Array(newW * newH);

  if (factor >= 1) {
    // Upscaling: nearest neighbor
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcX = Math.min(w - 1, Math.floor(x / factor));
        const srcY = Math.min(h - 1, Math.floor(y / factor));
        newMask[y * newW + x] = mask[srcY * w + srcX];
      }
    }
  } else {
    // Downscaling: preserve opaque pixels if any in the source area
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcX0 = Math.floor(x / factor);
        const srcX1 = Math.min(w - 1, Math.ceil((x + 1) / factor));
        const srcY0 = Math.floor(y / factor);
        const srcY1 = Math.min(h - 1, Math.ceil((y + 1) / factor));

        let hasOpaque = false;
        for (let sy = srcY0; sy <= srcY1; sy++) {
          for (let sx = srcX0; sx <= srcX1; sx++) {
            if (mask[sy * w + sx]) {
              hasOpaque = true;
              break;
            }
          }
          if (hasOpaque) break;
        }
        newMask[y * newW + x] = hasOpaque ? 1 : 0;
      }
    }
  }

  return { mask: newMask, w: newW, h: newH };
}