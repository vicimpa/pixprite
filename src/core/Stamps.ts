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

/** Creates a star stamp (5-pointed) */
function createStarStamp(): StampPreset {
  const w = 16, h = 16;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;
  const outerR = 7;
  const innerR = 3.5;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);

      // 5-pointed star: alternate between outer and inner radius
      const pointAngle = (angle + Math.PI / 5) * 5 / (2 * Math.PI);
      const pointIndex = Math.floor(pointAngle) % 5;
      const isOuter = pointIndex % 2 === 0;
      const targetR = isOuter ? outerR : innerR;

      // Smooth the edges slightly for better pixel art
      if (dist <= targetR + 0.5) {
        mask[y * w + x] = 1;
      }
    }
  }

  return {
    id: 'stamp.star',
    nameKey: 'stamp.star',
    mask,
    w,
    h,
    builtin: true,
  };
}

/** Creates a heart stamp */
function createHeartStamp(): StampPreset {
  const w = 16, h = 16;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.3;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      // Heart equation: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
      // Scaled and translated for pixel grid
      const nx = dx / 4.5;
      const ny = -dy / 4.5;
      const val = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3;
      if (val <= 0) {
        mask[y * w + x] = 1;
      }
    }
  }

  return {
    id: 'stamp.heart',
    nameKey: 'stamp.heart',
    mask,
    w,
    h,
    builtin: true,
  };
}

/** Creates a sparkle stamp (4-point star with center dot) */
function createSparkleStamp(): StampPreset {
  const w = 12, h = 12;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const dist = Math.hypot(dx, dy);

      // Center dot
      if (dist <= 1) {
        mask[y * w + x] = 1;
        continue;
      }

      // 4 rays (horizontal, vertical, diagonals)
      const isHorizontal = dy <= 0.5 && dx <= 4.5;
      const isVertical = dx <= 0.5 && dy <= 4.5;
      const isDiag1 = Math.abs(dx - dy) <= 0.5 && dx <= 3.5;
      const isDiag2 = Math.abs(dx + dy - 5) <= 0.5 && dx <= 3.5 && dy <= 3.5;

      if (isHorizontal || isVertical || isDiag1 || isDiag2) {
        mask[y * w + x] = 1;
      }
    }
  }

  return {
    id: 'stamp.sparkle',
    nameKey: 'stamp.sparkle',
    mask,
    w,
    h,
    builtin: true,
  };
}

/** Creates a diamond (rhombus) stamp */
function createDiamondStamp(): StampPreset {
  const w = 16, h = 16;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;
  const r = 7;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      // Diamond: |x| + |y| <= r
      if (dx + dy <= r + 0.5) {
        mask[y * w + x] = 1;
      }
    }
  }

  return {
    id: 'stamp.diamond',
    nameKey: 'stamp.diamond',
    mask,
    w,
    h,
    builtin: true,
  };
}

/** Creates a cross/plus stamp */
function createCrossStamp(): StampPreset {
  const w = 16, h = 16;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;
  const armLength = 7;
  const armWidth = 3;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);

      // Horizontal arm
      const inHorizontal = dy <= armWidth / 2 && dx <= armLength;
      // Vertical arm
      const inVertical = dx <= armWidth / 2 && dy <= armLength;

      if (inHorizontal || inVertical) {
        mask[y * w + x] = 1;
      }
    }
  }

  return {
    id: 'stamp.cross',
    nameKey: 'stamp.cross',
    mask,
    w,
    h,
    builtin: true,
  };
}

/** Creates a leaf stamp */
function createLeafStamp(): StampPreset {
  const w = 16, h = 20;
  const mask = new Uint8Array(w * h);
  const cx = w / 2 - 0.5;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - (h * 0.3);

      // Leaf shape: combination of two curves
      // Width varies along height - wider in middle, pointed at ends
      const normalizedY = y / (h - 1);
      if (normalizedY < 0.1 || normalizedY > 0.95) continue; // Stem area and tip

      // Leaf width profile (like a teardrop/leaf)
      let halfWidth: number;
      if (normalizedY < 0.5) {
        // Bottom half - widening
        halfWidth = 5.5 * Math.sin(normalizedY * Math.PI);
      } else {
        // Top half - narrowing to point
        halfWidth = 5.5 * Math.sin((1 - normalizedY) * 2 * Math.PI);
      }

      // Add slight asymmetry for natural look
      const asymmetry = 0.3 * Math.sin(normalizedY * Math.PI * 3);
      const leftEdge = -halfWidth + asymmetry;
      const rightEdge = halfWidth + asymmetry;

      if (dx >= leftEdge - 0.5 && dx <= rightEdge + 0.5) {
        // Add central vein (thin line down middle)
        if (Math.abs(dx - asymmetry) <= 0.5) {
          mask[y * w + x] = 1;
        } else {
          mask[y * w + x] = 1;
        }
      }
    }
  }

  // Add stem at bottom
  for (let y = Math.floor(h * 0.9); y < h; y++) {
    const x = Math.round(cx);
    if (x >= 0 && x < w) mask[y * w + x] = 1;
  }

  return {
    id: 'stamp.leaf',
    nameKey: 'stamp.leaf',
    mask,
    w,
    h,
    builtin: true,
  };
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