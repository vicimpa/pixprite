/** Built-in stamp presets: named pixel masks that can be used as brushes */

/** A stamp preset: a named pixel mask that can be used as a brush */
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

/** Creates a clean 5-pointed star stamp (13x10) */
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

/** Creates a clean heart stamp (9x8) */
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

/** Creates a sparkle stamp (13x11) */
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

/** Creates a diamond stamp (13x11) */
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

/** Creates a cross/plus stamp (9x9) */
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

/** Creates a clean leaf stamp (11x15) */
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
