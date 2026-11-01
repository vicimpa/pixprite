import { dialogs as common } from "./Common";
import { newSprite } from "./NewSprite";
import { colorModeDialog } from "./ColorMode";
import { sliceProperties } from "./Slice";
import { openShortcuts } from "./Shortcuts";
import { tilemapDialogs } from "./Tilemap";
import { filterDialogs } from "./Filters";
import { openMcp } from './Mcp';

export const dialogs = {
  ...common,
  ...tilemapDialogs,
  ...filterDialogs,
  mcp: openMcp,
  newSprite,
  colorMode: colorModeDialog,
  sliceProperties,
  shortcuts: openShortcuts,
  adjustColors: filterDialogs.hsl,
};

export { strokeSelectionDialog } from "./Stroke";
export { paletteDialogs } from "./Palette";
