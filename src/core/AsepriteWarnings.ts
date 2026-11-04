/** Import diagnostics survive working-copy/project saves; unsupported source data does not. */
export const ASEPRITE_WARNING_KINDS = [
  'pixelRatio', 'colorProfile', 'externalFiles', 'externalTileset', 'userProperties',
  'unknownChunk', 'layerType', 'blendMode', 'celType', 'celZIndex', 'layerMetadata',
  'paletteNames', 'tileFlags', 'userData', 'celBounds',
] as const;
export type AsepriteWarning = { kind: typeof ASEPRITE_WARNING_KINDS[number]; detail?: string };

export function validAsepriteWarnings(value: unknown): value is AsepriteWarning[] {
  return Array.isArray(value) && value.length <= 256 && value.every(item => item && typeof item === 'object'
    && ASEPRITE_WARNING_KINDS.includes(item.kind)
    && (item.detail === undefined || typeof item.detail === 'string' && item.detail.length <= 256));
}
