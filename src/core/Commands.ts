import { Color } from "~/core/Color";
import { exportFile, repeatLastExport, openFile, importIntoDocument, savePalette, copyToSystemClipboard, readSystemClipboard } from "~/core/Files";
import { flipH, flipV, packRgba, unpackRgba } from "~/core/Image";
import { LANGUAGES, t } from "~/core/i18n";
import { THEMES, themesVersion } from "~/core/Themes";
import { iconPackChoices, resolveIconPack } from './IconPacks';
import { effect, signal, untracked } from "@preact/signals-react";
import { FLIP_X, FLIP_Y, rotateRef } from "~/core/Tilemap";
import { Mask } from "~/core/Mask";
import { celPixel } from "~/core/Sprite";
import { DEFAULT_LAYOUT, state } from "~/core/State";
import { addGuide, clearGuides, openReference } from "~/core/Reference";
import { dialogs } from "~/modules/Dialogs";
import { askText } from "~/ui/Dialog";
import { strokeSelectionDialog } from "~/modules/Dialogs";
import { openExtensions } from "~/modules/Extensions/open";
import { paintSelection } from "~/core/Tools";
import { saveCurrentToLibrary } from "~/core/Brushes";
import { commandArgs, commandParams, PARAMETRIC } from "~/core/commandArgs";
import type { FormSchema, FormValues } from "@pixprite/api";

export type Command = {
  id: string;
  /** Text shown as is (language names); otherwise the label is the `cmd.<id>` text */
  label?: string;
  /** Menu text key the command is listed under (`menu.file`…) */
  group: string;
  keys?: string[];
  run: () => unknown;
  /** Arguments it takes when run by a program; built-ins describe theirs in commandArgs.ts */
  params?: FormSchema;
  /** Runs with checked arguments instead of asking (a command with `params` only) */
  apply?: (args: FormValues) => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** Also available on the home page */
  home?: boolean;
  /** Id of the extension that added it */
  ext?: string;
};

const s = () => state.sprite;
const hasSelection = () => !!(s().mask || s().floating);

function save() { state.save(); }

function changed<T extends unknown[]>(fn: (...args: T) => void) {
  return (...args: T) => { fn(...args); save(); };
}

function nudge(dx: number, dy: number) {
  const sprite = s();
  const f = sprite.floating ?? sprite.liftSelection();
  if (!f) return;
  sprite.moveFloating(f.place.x + dx, f.place.y + dy);
}

/** Next/previous frame; `inTag` wraps inside the current tag or loop section */
function frameStep(dir: 1 | -1, inTag = false) {
  const sprite = s();
  sprite.dropFloating();
  const { from, to } = inTag ? sprite.playRange() : { from: 0, to: sprite.frames.length - 1 };
  const len = to - from + 1;
  sprite.frame = from + (((sprite.frame - from + dir) % len) + len) % len;
  sprite.range = null;
}

const list: Command[] = [
  { id: 'file.new', group: 'menu.file', keys: ['Ctrl+Alt+N'], run: () => dialogs.newSprite() },
  { id: 'file.open', group: 'menu.file', keys: ['Ctrl+O'], run: () => openFile() },
  { id: 'file.importSheet', group: 'menu.file', run: () => dialogs.importSheet() },
  { id: 'file.importLayer', group: 'menu.file', run: () => importIntoDocument('layer') },
  { id: 'file.importFrames', group: 'menu.file', run: () => importIntoDocument('frames') },
  {
    id: 'file.save', group: 'menu.file', keys: ['Ctrl+S'], run: async () => {
      // The first save of a nameless document asks for a name
      if (!s().projectId && s().name === 'untitled') {
        const name = await askText(t('msg.nameOfTheProject'), 'untitled', { title: t('common.save'), ok: t('common.save') });
        if (!name) return;
        s().name = name;
      }
      void state.saveNow();
    }
  },
  {
    id: 'file.saveAs', group: 'menu.file', keys: ['Ctrl+Shift+S'], run: async () => {
      const name = await askText(t('msg.nameOfTheCopy'), `${s().name} copy`, { title: t('msg.saveAs'), ok: t('common.save') });
      if (name) void state.saveAs(name);
    }
  },
  { id: 'file.download', group: 'menu.file', run: () => dialogs.saveAs() },
  { id: 'file.export', group: 'menu.file', keys: ['Ctrl+Alt+E'], run: () => dialogs.exportImage() },
  { id: 'file.exportPng', group: 'menu.file', run: () => exportFile({ kind: 'png', scale: 1 }) },
  { id: 'file.repeatExport', group: 'menu.file', keys: ['Ctrl+Alt+Shift+E'], run: () => { if (!repeatLastExport()) dialogs.exportImage(); } },

  { id: 'edit.undo', group: 'menu.edit', keys: ['Ctrl+Z'], run: changed(() => { const l = s().history.at(-1); s().undo(); if (l) state.showNotice(`Undid: ${l}`); }), enabled: () => s().canUndo },
  { id: 'edit.redo', group: 'menu.edit', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: changed(() => { const l = s().future[0]; s().redo(); if (l) state.showNotice(`Redid: ${l}`); }), enabled: () => s().canRedo },
  { id: 'edit.history', group: 'menu.edit', keys: ['Ctrl+Alt+H'], run: () => dialogs.history() },
  {
    id: 'edit.cut', group: 'menu.edit', keys: ['Ctrl+X'], run: changed(() => {
      // A timeline range without a pixel selection: copy it, then remove it
      if (s().range && !s().mask && !s().floating) {
        state.rangeClipboard = s().copyRange();
        state.clipSource = null;
        state.clipKind = 'range';
        return deleteRange();
      }
      const origin = s().selectionOrigin ?? s().getCel() ?? undefined;
      const bmp = s().copySelection();
      state.clipboard = bmp && { ...bmp, x: origin?.x, y: origin?.y };
      copyToSystemClipboard(state.clipboard);
      s().clearSelection();
    })
  },
  {
    id: 'edit.copy', group: 'menu.edit', keys: ['Ctrl+C'], run: () => {
      // A timeline range without a pixel selection copies cels / frames / layers
      if (s().range && !s().mask && !s().floating) {
        state.rangeClipboard = s().copyRange();
        state.clipSource = { sprite: new WeakRef(s()), range: { ...s().range! } };
        state.clipKind = 'range';
        state.showNotice(`Copied ${s().range!.type}`);
        return;
      }
      state.clipKind = 'pixels';
      const origin = s().selectionOrigin ?? s().getCel() ?? undefined;
      const bmp = s().copySelection();
      state.clipboard = bmp && { ...bmp, x: origin?.x, y: origin?.y };
      copyToSystemClipboard(state.clipboard);
    }
  },
  {
    id: 'edit.copyMerged', group: 'menu.edit', keys: ['Alt+Shift+C'], run: () => {
      const origin = s().selectionOrigin ?? { x: 0, y: 0 };
      const bmp = s().copySelection(true);
      state.clipboard = bmp && { ...bmp, x: origin.x, y: origin.y };
      copyToSystemClipboard(state.clipboard);
    }
  },
  {
    id: 'edit.paste', group: 'menu.edit', run: changed(async () => {
      if (state.clipKind === 'range' && state.rangeClipboard) { state.clipSource = null; return s().pasteRange(state.rangeClipboard); }
      const bmp = await readSystemClipboard() ?? state.clipboard;
      if (bmp) { s().paste(bmp, state.pastePosition(bmp)); state.tool = 'move'; }
    })
  },
  {
    id: 'edit.pasteAsLayer', group: 'menu.edit', keys: ['Ctrl+Shift+V'], run: changed(async () => {
      const bmp = await readSystemClipboard() ?? state.clipboard;
      if (!bmp) return state.showTip(t('msg.theClipboardHasNo'));
      s().addLayer();
      s().paste(bmp, state.pastePosition(bmp), 'Paste as new layer');
      state.tool = 'move';
    })
  },
  {
    id: 'edit.clear', group: 'menu.edit', keys: ['Delete', 'Backspace'], run: changed(() => {
      // With the slice tool, Delete removes the picked slices
      if (state.activeTool === 'slice' && s().selectedSlices.length) return s().removeSlices();
      if (s().range && !s().mask && !s().floating) return deleteRange();
      s().clearSelection();
    })
  },
  {
    id: 'edit.fill', group: 'menu.edit', keys: ['Alt+Backspace'], run: changed(() => {
      const [r, g, b, a] = state.colorA.rgba;
      const v = packRgba(r, g, b, Math.round(a * 255));
      s().mapPixels('Fill selection', () => v);
    })
  },
  { id: 'edit.flipH', group: 'menu.edit', keys: ['Shift+H'], run: changed(() => s().transformSelection('Mirror', flipH)) },
  { id: 'edit.flipV', group: 'menu.edit', keys: ['Shift+V'], run: changed(() => s().transformSelection('Mirror', flipV)) },
  { id: 'edit.rotateCw', group: 'menu.edit', keys: ['Ctrl+R'], run: changed(() => s().rotateSelection(1)) },
  { id: 'edit.rotateCcw', group: 'menu.edit', keys: ['Ctrl+Shift+R'], run: changed(() => s().rotateSelection(3)) },
  { id: 'edit.rotate180', group: 'menu.edit', run: changed(() => s().rotateSelection(2)) },
  { id: 'edit.brushFromSelection', group: 'menu.edit', keys: ['Ctrl+B'], run: () => {
    const sprite = s();
    const bmp = sprite.copySelection();
    const origin = sprite.selectionOrigin ?? { x: 0, y: 0 };
    if (!bmp) return;
    state.customBrush = { bmp, ox: origin.x, oy: origin.y, align: state.customBrush?.align ?? 'stroke' };
    sprite.deselect();
    state.tool = 'pencil';
    state.showTip(t('msg.brushCaptured'));
  }, enabled: () => !!s().mask },
  { id: 'edit.patternFromSelection', group: 'menu.edit', run: () => {
    // Opaque pixels of the selected area become primary-color cells, the rest secondary
    const bmp = s().copySelection();
    if (!bmp) return;
    const bits = new Uint8Array(bmp.w * bmp.h);
    for (let i = 0; i < bits.length; i++) bits[i] = bmp.data[i] >>> 24 ? 1 : 0;
    state.patternBits = { w: bmp.w, h: bmp.h, bits };
    state.paintPattern = 'custom';
    state.showTip(t('msg.patternCaptured'));
  }, enabled: () => !!s().mask },
  { id: 'edit.strokeSelection', group: 'menu.edit', run: () => strokeSelectionDialog(), enabled: () => !!s().mask && !s().floating },
  { id: 'edit.fillWithBrush', group: 'menu.edit', run: changed(() => { paintSelection(0, 'inside', 'Fill selection'); }), enabled: () => !!s().mask && !s().floating },
  { id: 'brush.saveToLibrary', group: 'menu.edit', run: () => { if (saveCurrentToLibrary('library')) state.showTip(t('msg.savedToTheBrush')); }, enabled: () => !!state.customBrush || !!state.patternBits },
  { id: 'brush.saveToDocument', group: 'menu.edit', run: () => { if (saveCurrentToLibrary('document')) { state.showTip(t('msg.savedInTheProject')); save(); } }, enabled: () => !!state.customBrush || !!state.patternBits },
  { id: 'edit.discardBrush', group: 'menu.edit', run: () => { state.customBrush = null; }, enabled: () => !!state.customBrush },
  { id: 'edit.replaceColor', group: 'menu.edit', run: () => dialogs.replaceColor() },
  {
    id: 'edit.invert', group: 'menu.edit', keys: ['Ctrl+I'], run: changed(() => s().mapPixels('Negative', v => {
      const [r, g, b, a] = unpackRgba(v);
      return packRgba(255 - r, 255 - g, 255 - b, a);
    }))
  },
  {
    id: 'edit.grayscale', group: 'menu.edit', keys: ['Ctrl+Shift+U'], run: changed(() => s().mapPixels('Desaturate', v => {
      const [r, g, b, a] = unpackRgba(v);
      const l = Math.round(r * .299 + g * .587 + b * .114);
      return packRgba(l, l, l, a);
    }))
  },
  { id: 'edit.adjust', group: 'menu.edit', keys: ['Ctrl+U'], run: () => dialogs.adjustColors() },
  { id: 'fx.outline', group: 'menu.edit', run: () => dialogs.outline() },
  { id: 'fx.shadow', group: 'menu.edit', run: () => dialogs.shadow() },
  { id: 'fx.convolution', group: 'menu.edit', run: () => dialogs.convolution() },
  { id: 'fx.median', group: 'menu.edit', run: () => dialogs.median() },
  { id: 'fx.curves', group: 'menu.edit', keys: ['Ctrl+Alt+M'], run: () => dialogs.curves() },
  { id: 'fx.negative', group: 'menu.edit', run: () => dialogs.invert() },
  { id: 'fx.posterize', group: 'menu.edit', run: () => dialogs.posterize() },
  { id: 'fx.brightness', group: 'menu.edit', run: () => dialogs.brightness() },
  { id: 'fx.noise', group: 'menu.edit', run: () => dialogs.noise() },
  { id: 'fx.pixelate', group: 'menu.edit', run: () => dialogs.pixelate() },
  { id: 'fx.offset', group: 'menu.edit', run: () => dialogs.offset() },
  { id: 'file.savePalette', group: 'menu.file', run: () => savePalette('gpl') },
  { id: 'edit.prefs', group: 'menu.edit', keys: ['Ctrl+,'], run: () => dialogs.preferences() },

  { id: 'image.properties', group: 'menu.image', run: () => dialogs.spriteProperties() },
  { id: 'image.colorMode', group: 'menu.image', run: () => dialogs.colorMode() },
  { id: 'image.canvasSize', group: 'menu.image', keys: ['Ctrl+Alt+C'], run: () => dialogs.canvasSize() },
  { id: 'image.spriteSize', group: 'menu.image', keys: ['Ctrl+Alt+I'], run: () => dialogs.spriteSize() },
  { id: 'image.rotateCw', group: 'menu.image', run: changed(() => s().rotateSprite(1)) },
  { id: 'image.rotateCcw', group: 'menu.image', run: changed(() => s().rotateSprite(3)) },
  { id: 'image.rotate180', group: 'menu.image', run: changed(() => s().rotateSprite(2)) },
  { id: 'image.flipH', group: 'menu.image', run: changed(() => s().flipSprite('h')) },
  { id: 'image.flipV', group: 'menu.image', run: changed(() => s().flipSprite('v')) },
  { id: 'image.crop', group: 'menu.image', run: changed(() => s().cropToSelection()), enabled: () => !!s().mask },
  { id: 'image.trim', group: 'menu.image', run: changed(() => s().trim()) },

  { id: 'layer.new', group: 'menu.layer', keys: ['Shift+N'], run: changed(() => state.showNotice(`${s().addLayer()} created`)) },
  { id: 'layer.newBelow', group: 'menu.layer', run: changed(() => state.showNotice(`${s().addLayer(true)} created`)) },
  { id: 'layer.newGroup', group: 'menu.layer', run: changed(() => s().addGroup()) },
  { id: 'layer.newTilemap', group: 'menu.layer', run: () => dialogs.newTilemap() },
  { id: 'layer.toTilemap', group: 'menu.layer', run: () => dialogs.toTilemap(), enabled: () => !!s().current && s().current.tileset < 0 && !s().current.group && !s().current.background },
  { id: 'layer.toPixels', group: 'menu.layer', run: changed(() => s().convertToPixels()), enabled: () => (s().current?.tileset ?? -1) >= 0 },
  { id: 'layer.changeTileset', group: 'menu.layer', run: () => dialogs.changeTileset(), enabled: () => !!s().tileset && s().tilesets.length > 1 },
  { id: 'tiles.flipX', group: 'menu.layer', keys: ['Alt+H'], run: () => { state.tileA = (state.tileA ^ FLIP_X) >>> 0; }, enabled: () => !!s().tileset },
  { id: 'tiles.flipY', group: 'menu.layer', keys: ['Alt+V'], run: () => { state.tileA = (state.tileA ^ FLIP_Y) >>> 0; }, enabled: () => !!s().tileset },
  { id: 'tiles.rotate', group: 'menu.layer', keys: ['Alt+R'], run: () => { state.tileA = rotateRef(state.tileA); }, enabled: () => !!s().tileset && s().tileset!.tw === s().tileset!.th },
  { id: 'tiles.removeUnused', group: 'menu.layer', run: () => { const n = s().removeUnusedTiles(); if (n) state.save(); state.showNotice(t('msg.tilesRemovedN', { n })); }, enabled: () => !!s().tileset },
  { id: 'tiles.mergeDuplicates', group: 'menu.layer', run: () => { const n = s().mergeDuplicateTiles(); if (n) state.save(); state.showNotice(t('msg.tilesMergedN', { n })); }, enabled: () => !!s().tileset },
  { id: 'tiles.mode', group: 'menu.layer', run: () => { state.tilemapMode = state.tilemapMode === 'tiles' ? 'pixels' : 'tiles'; }, enabled: () => !!s().tileset },
  { id: 'layer.ungroup', group: 'menu.layer', run: changed(() => s().ungroup()), enabled: () => !!s().current?.group },
  { id: 'layer.outOfGroup', group: 'menu.layer', run: changed(() => s().moveOutOfGroup()), enabled: () => !!s().current?.depth },
  { id: 'layer.duplicate', group: 'menu.layer', keys: ['Ctrl+J'], run: changed(() => s().duplicateLayer()) },
  { id: 'layer.delete', group: 'menu.layer', run: changed(() => { if (!s().removeLayers()) state.showTip(t('msg.cantDeleteEveryLayer')); }), enabled: () => s().layers.length > 1 },
  { id: 'layer.toBackground', group: 'menu.layer', run: changed(() => s().layerToBackground()), enabled: () => s().backgroundIndex < 0 && !s().current?.group },
  { id: 'layer.fromBackground', group: 'menu.layer', run: changed(() => s().backgroundToLayer()), enabled: () => s().backgroundIndex >= 0 },
  { id: 'layer.continuous', group: 'menu.layer', run: changed(() => s().updateLayer(s().layer, { continuous: !s().current.continuous }, 'Continuous')), checked: () => !!s().current?.continuous },
  { id: 'layer.reference', group: 'menu.layer', run: () => void openReference() },
  { id: 'layer.clip', group: 'menu.layer', run: changed(() => s().updateLayer(s().layer, { clip: !s().current.clip }, 'Clipping')), checked: () => !!s().current?.clip, enabled: () => !!s().current && !s().current.background && !s().current.reference },
  { id: 'layer.solo', group: 'menu.layer', run: changed(() => s().soloLayer(s().layer)) },
  { id: 'layer.properties', group: 'menu.layer', keys: ['Ctrl+Shift+L'], run: () => dialogs.layerProperties() },
  { id: 'layer.visible', group: 'menu.layer', run: changed(() => s().updateLayer(s().layer, { visible: !s().current.visible }, 'Toggle visibility')), checked: () => !!s().current?.visible },
  { id: 'layer.lock', group: 'menu.layer', run: changed(() => s().updateLayer(s().layer, { locked: !s().current.locked }, 'Toggle lock')), checked: () => !!s().current?.locked },
  { id: 'layer.up', group: 'menu.layer', keys: ['Ctrl+]'], run: changed(() => s().moveLayer(1)) },
  { id: 'layer.down', group: 'menu.layer', keys: ['Ctrl+['], run: changed(() => s().moveLayer(-1)) },
  { id: 'layer.mergeDown', group: 'menu.layer', keys: ['Ctrl+E'], run: changed(() => s().mergeDown()), enabled: () => s().canMergeDown },
  { id: 'layer.mergeVisible', group: 'menu.layer', run: changed(() => s().mergeVisible()), enabled: () => s().canMergeVisible },
  { id: 'layer.mergeSelected', group: 'menu.layer', run: changed(() => s().mergeSelected()), enabled: () => !!s().rangeNodes },
  { id: 'layer.flatten', group: 'menu.layer', keys: ['Ctrl+Shift+E'], run: changed(() => s().flattenAll()), enabled: () => s().layers.length > 1 },
  { id: 'layer.prev', group: 'menu.layer', keys: ['Down'], run: () => { s().layer = Math.max(0, s().layer - 1); } },
  { id: 'layer.next', group: 'menu.layer', keys: ['Up'], run: () => { s().layer = Math.min(s().layers.length - 1, s().layer + 1); } },

  { id: 'anim.newFrame', group: 'menu.animation', keys: ['Alt+N'], run: changed(() => s().addFrame('duplicate')) },
  { id: 'anim.newEmptyFrame', group: 'menu.animation', keys: ['Alt+Shift+N'], run: changed(() => s().addFrame('empty')) },
  { id: 'anim.deleteFrame', group: 'menu.animation', keys: ['Alt+Delete'], run: changed(() => s().removeFrames()), enabled: () => s().frames.length > 1 },
  { id: 'anim.frameProperties', group: 'menu.animation', keys: ['Alt+T'], run: () => dialogs.frameProperties() },
  { id: 'anim.reverse', group: 'menu.animation', run: changed(() => s().reverseFrames()) },
  { id: 'anim.tween', group: 'menu.animation', run: () => dialogs.tweenFrames() },
  { id: 'anim.nudgeLeft', group: 'menu.animation', keys: ['Ctrl+Alt+Left'], run: changed(() => s().nudgeCels(-1, 0)) },
  { id: 'anim.nudgeRight', group: 'menu.animation', keys: ['Ctrl+Alt+Right'], run: changed(() => s().nudgeCels(1, 0)) },
  { id: 'anim.nudgeUp', group: 'menu.animation', keys: ['Ctrl+Alt+Up'], run: changed(() => s().nudgeCels(0, -1)) },
  { id: 'anim.nudgeDown', group: 'menu.animation', keys: ['Ctrl+Alt+Down'], run: changed(() => s().nudgeCels(0, 1)) },
  { id: 'anim.nudgeLeftGrid', group: 'menu.animation', keys: ['Ctrl+Alt+Shift+Left'], run: changed(() => s().nudgeCels(-state.prefs.gridW, 0)) },
  { id: 'anim.nudgeRightGrid', group: 'menu.animation', keys: ['Ctrl+Alt+Shift+Right'], run: changed(() => s().nudgeCels(state.prefs.gridW, 0)) },
  { id: 'anim.nudgeUpGrid', group: 'menu.animation', keys: ['Ctrl+Alt+Shift+Up'], run: changed(() => s().nudgeCels(0, -state.prefs.gridH)) },
  { id: 'anim.nudgeDownGrid', group: 'menu.animation', keys: ['Ctrl+Alt+Shift+Down'], run: changed(() => s().nudgeCels(0, state.prefs.gridH)) },
  { id: 'anim.moveLeft', group: 'menu.animation', keys: ['Alt+Left'], run: changed(() => s().moveFrame(-1)) },
  { id: 'anim.moveRight', group: 'menu.animation', keys: ['Alt+Right'], run: changed(() => s().moveFrame(1)) },
  { id: 'anim.newTag', group: 'menu.animation', run: () => { s().addTag(); dialogs.tagProperties(s().tags.length - 1); } },
  { id: 'anim.loop', group: 'menu.animation', keys: ['Alt+L'], run: () => s().setLoopSection(), checked: () => !!s().loop },
  { id: 'anim.first', group: 'menu.animation', keys: ['Home'], run: () => { s().dropFloating(); s().frame = 0; s().range = null; } },
  { id: 'anim.prev', group: 'menu.animation', keys: ['Left'], run: () => frameStep(-1) },
  { id: 'anim.next', group: 'menu.animation', keys: ['Right'], run: () => frameStep(1) },
  { id: 'anim.prevInTag', group: 'menu.animation', keys: [','], run: () => frameStep(-1, true) },
  { id: 'anim.nextInTag', group: 'menu.animation', keys: ['.'], run: () => frameStep(1, true) },
  { id: 'anim.last', group: 'menu.animation', keys: ['End'], run: () => { s().dropFloating(); s().frame = s().frames.length - 1; s().range = null; } },
  { id: 'anim.goto', group: 'menu.animation', keys: ['Alt+G'], run: () => dialogs.gotoFrame() },
  { id: 'cel.duplicate', group: 'menu.animation', keys: ['Alt+D'], run: changed(() => s().duplicateCels(false)) },
  { id: 'cel.duplicateLinked', group: 'menu.animation', keys: ['Alt+Shift+D'], run: changed(() => s().duplicateCels(true)) },
  { id: 'cel.link', group: 'menu.animation', run: changed(() => s().linkCels()), enabled: () => !!s().range && s().selectedFrames.length > 1 },
  { id: 'cel.unlink', group: 'menu.animation', run: changed(() => s().unlinkCels()) },
  { id: 'cel.clear', group: 'menu.animation', run: changed(() => s().clearCels()) },
  { id: 'cel.properties', group: 'menu.animation', run: () => dialogs.celProperties() },
  { id: 'anim.play', group: 'menu.animation', keys: ['Enter'], run: () => { state.playing = !state.playing; }, checked: () => state.playing },
  { id: 'anim.onion', group: 'menu.animation', keys: ['O'], run: () => { state.onion = !state.onion; }, checked: () => state.onion },

  { id: 'select.all', group: 'menu.select', keys: ['Ctrl+A'], run: () => s().selectAll() },
  { id: 'select.none', group: 'menu.select', keys: ['Ctrl+D'], run: changed(() => s().deselect()), enabled: hasSelection },
  { id: 'select.reselect', group: 'menu.select', keys: ['Ctrl+Shift+D'], run: () => s().reselect() },
  { id: 'select.invert', group: 'menu.select', keys: ['Ctrl+Alt+A'], run: () => s().invertSelection() },
  {
    id: 'select.color', group: 'menu.select', run: () => {
      const sprite = s();
      const [r, g, b, a] = state.colorA.rgba;
      const v = packRgba(r, g, b, Math.round(a * 255));
      const cel = sprite.getBitmap().data;
      sprite.setMask(Mask.fromFn(sprite.width, sprite.height, (x, y) => cel[y * sprite.width + x] === v), 'Select color');
    }
  },
  { id: 'select.grow', group: 'menu.select', run: () => s().mask && s().setMask(s().mask!.morph(1), 'Grow selection'), enabled: () => !!s().mask },
  { id: 'select.shrink', group: 'menu.select', run: () => s().mask && s().setMask(s().mask!.morph(-1), 'Shrink selection'), enabled: () => !!s().mask },
  { id: 'select.border', group: 'menu.select', run: () => s().mask && s().setMask(s().mask!.border(1), 'Selection outline'), enabled: () => !!s().mask },
  { id: 'select.drop', group: 'menu.select', keys: ['Enter'], run: changed(() => s().dropFloating()), enabled: () => !!s().floating },
  { id: 'select.cancelTransform', group: 'menu.select', run: changed(() => s().cancelFloating()), enabled: () => !!s().floating },
  { id: 'select.escape', group: 'menu.select', keys: ['Escape'], run: changed(() => { s().dropFloating(); s().deselect(); s().range = null; }), enabled: () => !!(s().floating || s().mask || s().range) },
  { id: 'select.content', group: 'menu.select', run: () => {
    const sprite = s(), cel = sprite.getCel();
    if (!cel) return;
    sprite.setMask(Mask.fromFn(sprite.width, sprite.height, (x, y) => (celPixel(cel, x, y) >>> 24) > 0), 'Select content');
  } },
  { id: 'select.alpha', group: 'menu.select', run: () => {
    // Uses the current selection mode (replace / add / subtract / intersect); half-transparent pixels count when alpha ≥ 50%
    const sprite = s(), cel = sprite.getCel();
    if (!cel) return;
    const m = Mask.fromFn(sprite.width, sprite.height, (x, y) => (celPixel(cel, x, y) >>> 24) >= 128);
    sprite.setMask(sprite.mask ? sprite.mask.combine(m, state.selectMode) : m, 'Select by opacity');
  } },
  { id: 'select.gridAsSelection', group: 'menu.select', run: () => {
    const b = s().mask?.bounds;
    if (!b) return;
    state.setPrefs({ gridX: b.x % b.w, gridY: b.y % b.h, gridW: b.w, gridH: b.h });
    state.showGrid = true;
  }, enabled: () => !!s().mask },

  { id: 'view.zoomIn', group: 'menu.view', keys: ['=', '+', 'Ctrl+='], run: () => state.zoomStep(1) },
  { id: 'view.zoomOut', group: 'menu.view', keys: ['-', 'Ctrl+-'], run: () => state.zoomStep(-1) },
  { id: 'view.actual', group: 'menu.view', keys: ['Shift+1'], run: () => state.flyTo(1, s().width / 2, s().height / 2) },
  { id: 'view.fit', group: 'menu.view', keys: ['Ctrl+0'], run: () => state.fitSmooth() },
  { id: 'view.center', group: 'menu.view', keys: ['Shift+C'], run: () => state.center() },
  { id: 'view.pixelGrid', group: 'menu.view', keys: ['Ctrl+Shift+G'], run: () => { state.showPixelGrid = !state.showPixelGrid; }, checked: () => state.showPixelGrid },
  { id: 'view.slices', group: 'menu.view', run: () => { state.showSlices = !state.showSlices; }, checked: () => state.showSlices },
  { id: 'view.flip', group: 'menu.view', keys: ['Alt+F'], run: () => { state.flipView = !state.flipView; }, checked: () => state.flipView },
  { id: 'view.rulers', group: 'menu.view', keys: ['Ctrl+Alt+R'], run: () => { state.showRulers = !state.showRulers; }, checked: () => state.showRulers },
  { id: 'view.guideV', group: 'menu.view', run: () => addGuide('x') },
  { id: 'view.guideH', group: 'menu.view', run: () => addGuide('y') },
  { id: 'view.clearGuides', group: 'menu.view', run: () => clearGuides(), enabled: () => state.guides.length > 0 },
  { id: 'view.lockGuides', group: 'menu.view', run: () => { state.sprite.guidesLocked = !state.sprite.guidesLocked; }, checked: () => state.sprite.guidesLocked },
  { id: 'view.snapGuides', group: 'menu.view', run: () => { state.snapToGuides = !state.snapToGuides; }, checked: () => state.snapToGuides },
  { id: 'view.layerEdges', group: 'menu.view', keys: ['Ctrl+Alt+L'], run: () => { state.showLayerEdges = !state.showLayerEdges; }, checked: () => state.showLayerEdges },
  { id: 'view.grid', group: 'menu.view', keys: ['Ctrl+G'], run: () => { state.showGrid = !state.showGrid; }, checked: () => state.showGrid },
  { id: 'view.snap', group: 'menu.view', keys: ['Ctrl+Alt+G'], run: () => { state.snapToGrid = !state.snapToGrid; }, checked: () => state.snapToGrid },
  { id: 'view.gridSettings', group: 'menu.view', run: () => dialogs.preferences('grid') },
  { id: 'view.tileX', group: 'menu.view', run: () => { state.tiledX = !state.tiledX; }, checked: () => state.tiledX },
  { id: 'view.tileY', group: 'menu.view', run: () => { state.tiledY = !state.tiledY; }, checked: () => state.tiledY },
  { id: 'view.symX', group: 'menu.view', run: () => { state.symmetryX = !state.symmetryX; }, checked: () => state.symmetryX },
  { id: 'view.symY', group: 'menu.view', run: () => { state.symmetryY = !state.symmetryY; }, checked: () => state.symmetryY },
  { id: 'view.symD1', group: 'menu.view', run: () => { state.symmetryD1 = !state.symmetryD1; }, checked: () => state.symmetryD1 },
  { id: 'view.symD2', group: 'menu.view', run: () => { state.symmetryD2 = !state.symmetryD2; }, checked: () => state.symmetryD2 },
  { id: 'view.preview', group: 'menu.view', keys: ['Ctrl+Alt+P'], run: () => state.setLayout({ showPreview: !state.layout.showPreview }), checked: () => state.layout.showPreview },
  { id: 'view.fullscreenPreview', group: 'menu.view', keys: ['Ctrl+Alt+F'], run: () => { state.fullscreenPreview = !state.fullscreenPreview; }, checked: () => state.fullscreenPreview },

  {
    id: 'window.focus', group: 'menu.window', keys: ['Tab'], run: () => {
      const { layout } = state;
      const anyShown = layout.showToolbar || layout.showColors || layout.showTimeline || layout.showOptions;
      state.setLayout({ showToolbar: !anyShown, showColors: !anyShown, showTimeline: !anyShown, showOptions: !anyShown });
    }
  },
  { id: 'window.toolbar', group: 'menu.window', run: () => state.setLayout({ showToolbar: !state.layout.showToolbar }), checked: () => state.layout.showToolbar },
  { id: 'window.colors', group: 'menu.window', run: () => state.setLayout({ showColors: !state.layout.showColors }), checked: () => state.layout.showColors },
  { id: 'window.timeline', group: 'menu.window', keys: ['Ctrl+Alt+T'], run: () => state.setLayout({ showTimeline: !state.layout.showTimeline }), checked: () => state.layout.showTimeline },
  { id: 'window.options', group: 'menu.window', run: () => state.setLayout({ showOptions: !state.layout.showOptions }), checked: () => state.layout.showOptions },
  { id: 'window.status', group: 'menu.window', run: () => state.setLayout({ showStatus: !state.layout.showStatus }), checked: () => state.layout.showStatus },
  { id: 'window.toolbarLeft', group: 'menu.window', run: () => state.setLayout({ toolbar: 'left' }), checked: () => state.layout.toolbar === 'left' },
  { id: 'window.toolbarRight', group: 'menu.window', run: () => state.setLayout({ toolbar: 'right' }), checked: () => state.layout.toolbar === 'right' },
  { id: 'window.colorsLeft', group: 'menu.window', run: () => state.setLayout({ colors: 'left' }), checked: () => state.layout.colors === 'left' },
  { id: 'window.colorsRight', group: 'menu.window', run: () => state.setLayout({ colors: 'right' }), checked: () => state.layout.colors === 'right' },
  { id: 'window.timelineBottom', group: 'menu.window', run: () => state.setLayout({ timeline: 'bottom' }), checked: () => state.layout.timeline === 'bottom' },
  { id: 'window.timelineTop', group: 'menu.window', run: () => state.setLayout({ timeline: 'top' }), checked: () => state.layout.timeline === 'top' },
  { id: 'window.reset', group: 'menu.window', run: () => { state.layout = { ...DEFAULT_LAYOUT }; } },

  { id: 'color.swap', group: 'menu.colors', keys: ['X'], run: () => state.swapColors() },
  { id: 'color.reset', group: 'menu.colors', keys: ['D'], run: () => { state.colorA = Color.fromHex('#000000'); state.colorB = Color.fromHex('#ffffff'); } },
  { id: 'brush.smaller', group: 'menu.colors', keys: ['['], run: () => { state.brushSize = Math.max(1, state.brushSize - 1); } },
  { id: 'brush.bigger', group: 'menu.colors', keys: [']'], run: () => { state.brushSize = Math.min(64, state.brushSize + 1); } },

  { id: 'file.close', group: 'menu.file', keys: ['Ctrl+Alt+W'], run: () => state.closeDocument() },
  { id: 'file.duplicate', group: 'menu.file', run: () => state.duplicateDocument() },
  { id: 'window.nextTab', group: 'menu.window', keys: ['Alt+PageDown'], run: () => { const d = state.docs; state.switchTo(d[(d.indexOf(state.sprite) + 1) % d.length]); } },
  { id: 'window.prevTab', group: 'menu.window', keys: ['Alt+PageUp'], run: () => { const d = state.docs; state.switchTo(d[(d.indexOf(state.sprite) - 1 + d.length) % d.length]); } },
  {
    id: 'window.fullscreen', group: 'menu.window', keys: ['F11'],
    run: () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { }); },
    checked: () => !!document.fullscreenElement,
  },
  { id: 'view.hints', group: 'menu.view', run: () => state.setPrefs({ showHints: !state.prefs.showHints }), checked: () => state.prefs.showHints },
  { id: 'view.commandPalette', group: 'menu.view', keys: ['Ctrl+K'], run: () => { state.commandPalette = true; } },
  // Loaded on demand: the extensions window pulls in the whole extension host
  { id: 'extensions.openStore', group: 'menu.extensions', home: true, run: () => openExtensions('store') },
  { id: 'extensions.openInstalled', group: 'menu.extensions', home: true, run: () => openExtensions('installed') },
  { id: 'help.shortcuts', group: 'menu.help', keys: ['F1'], run: () => dialogs.shortcuts() },
  { id: 'help.about', group: 'menu.help', run: () => dialogs.about() },
  { id: 'help.github', group: 'menu.help', run: () => void open('https://github.com/vicimpa/pixprite', '_blank', 'noopener') },
];

/** Arrow keys move the selection instead of switching frames/layers when something is selected */
/** With a selection, arrows move its pixels (Shift: one grid cell), Alt+arrows move only the outline */
const nudges: Command[] = ([['Left', -1, 0], ['Right', 1, 0], ['Up', 0, -1], ['Down', 0, 1]] as const).flatMap(([key, dx, dy]) => [
  { id: `nudge.${key}`, group: 'menu.select', keys: [key], run: changed(() => nudge(dx, dy)), enabled: hasSelection },
  { id: `nudgeCell.${key}`, group: 'menu.select', keys: [`Shift+${key}`], run: changed(() => nudge(dx * state.prefs.gridW, dy * state.prefs.gridH)), enabled: hasSelection },
  { id: `outline.${key}`, group: 'menu.select', keys: [`Alt+${key}`], run: () => s().moveMask(dx, dy), enabled: () => !!s().mask && !s().floating },
]);

// Defaults avoid combinations the browser or the OS keep for themselves (new window / tab,
// close tab, switch tabs, hide / minimize the app, developer tools): those never reach the page.
/** Every registered command (built-in and from extensions), in menu order */
export const COMMANDS: Command[] = [];
/** Removes the timeline range: whole frames / layers, or clears the cels */
function deleteRange() {
  const r = s().range!;
  if (r.type === 'frames') { if (s().frames.length > r.frames[1] - r.frames[0] + 1) s().removeFrames(); }
  else if (r.type === 'layers') { if (s().layers.length > r.layers[1] - r.layers[0] + 1) s().removeLayers(); }
  else s().clearCels();
}

export const commands = new Map<string, Command>();

/** Bumped whenever a command is added or removed, so menus and the palette can re-render */
export const commandsVersion = signal(0);

/** Default shortcuts, kept so user changes can be reset */
const DEFAULT_KEYS = new Map<string, string[]>();

function loadOverrides(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem('pixprite:keys') ?? '{}'); } catch { return {}; }
}

/** User shortcuts are stored as a layer over the defaults */
const overrides = loadOverrides();

/**
 * Adds a command (built-ins go through here too); the user's shortcut for it, if any, is applied.
 * A command with the same id replaces the old one. Returns the function that removes it.
 */
export function registerCommand(c: Command) {
  const old = commands.get(c.id);
  if (old) COMMANDS.splice(COMMANDS.indexOf(old), 1, c);
  else COMMANDS.push(c);
  commands.set(c.id, c);
  DEFAULT_KEYS.set(c.id, c.keys?.slice() ?? []);
  c.keys = (overrides[c.id] ?? c.keys ?? []).slice();
  untracked(() => commandsVersion.value++);
  return () => {
    if (commands.get(c.id) !== c) return;
    COMMANDS.splice(COMMANDS.indexOf(c), 1);
    commands.delete(c.id);
    DEFAULT_KEYS.delete(c.id);
    untracked(() => commandsVersion.value++);
  };
}

for (const c of [...nudges, ...list]) registerCommand(c);

/** Keeps one command per entry of a registry that can change (themes, languages, icon packs) */
function syncCommands(entries: () => [string, string][], make: (id: string, name: string) => Command) {
  const live = new Map<string, () => void>();
  effect(() => {
    const now = new Map(entries());
    untracked(() => {
      for (const [id, off] of live) if (!now.has(id)) { off(); live.delete(id); }
      for (const [id, name] of now) {
        const c = make(id, name);
        if (commands.get(c.id)?.label !== name || !live.has(id)) { live.get(id)?.(); live.set(id, registerCommand(c)); }
      }
    });
  });
}

syncCommands(() => (void themesVersion.value, Object.entries(THEMES)), (id, name) => ({
  id: `window.theme.${id}`, group: 'menu.window', label: name, run: () => state.setPrefs({ theme: id }), checked: () => state.prefs.theme === id,
}));
syncCommands(() => Object.entries(LANGUAGES), (id, name) => ({
  id: `window.lang.${id}`, group: 'menu.window', label: name, run: () => state.setPrefs({ language: id }), checked: () => state.prefs.language === id,
}));
syncCommands(() => iconPackChoices(t), (id, name) => ({
  id: `window.icons.${id}`, group: 'menu.window', label: name,
  run: () => state.setPrefs({ iconPack: id }),
  checked: () => resolveIconPack(state.prefs.iconPack) === id,
}));

function storeOverrides() {
  const o: Record<string, string[]> = {};
  for (const c of COMMANDS) {
    const def = DEFAULT_KEYS.get(c.id) ?? [];
    const keys = c.keys ?? [];
    if (keys.join('|') !== def.join('|')) o[c.id] = keys;
  }
  try { localStorage.setItem('pixprite:keys', JSON.stringify(o)); } catch { }
  commandsVersion.value++;
}

/** Which command already uses a combo (ignoring `except`) */
export function commandForCombo(combo: string, except?: string) {
  return COMMANDS.find(c => c.id !== except && c.keys?.includes(combo)) ?? null;
}

/** Assign a combo to a command; whoever had it loses it */
export function bindKey(id: string, combo: string) {
  for (const c of COMMANDS) if (c.keys?.includes(combo)) c.keys = c.keys.filter(k => k !== combo);
  const c = cmd(id);
  c.keys = [...(c.keys ?? []), combo];
  storeOverrides();
}

export function unbindKey(id: string, combo: string) {
  const c = cmd(id);
  c.keys = (c.keys ?? []).filter(k => k !== combo);
  storeOverrides();
}

export function resetKeys(id?: string) {
  for (const c of COMMANDS) if (!id || c.id === id) c.keys = (DEFAULT_KEYS.get(c.id) ?? []).slice();
  storeOverrides();
}

/** Text key of a command's label: `cmd.` + its id with each part starting lowercase (`nudge.Left` → `cmd.nudge.left`) */
export const commandKey = (id: string) => 'cmd.' + id.split('.').map(p => p[0].toLowerCase() + p.slice(1)).join('.');

export const commandLabel = (c: Command) => c.label ?? t(commandKey(c.id));

export function cmd(id: string) {
  const c = commands.get(id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return c;
}

/** Commands that make sense on the home page (no document is being edited there) */
const HOME_COMMANDS = new Set([
  'file.new', 'file.open', 'file.importSheet', 'edit.prefs', 'help.shortcuts', 'help.about', 'view.commandPalette',
  'window.nextTab', 'window.prevTab', 'window.fullscreen',
]);
const isHomeCommand = (id: string) => HOME_COMMANDS.has(id) || id.startsWith('window.theme.') || id.startsWith('window.lang.') || id.startsWith('window.icons.');

/** Can run now: enabled, and outside the editor only the home page commands */
export function available(c: Command) {
  if (state.home && !isHomeCommand(c.id) && !c.home) return false;
  return !c.enabled || c.enabled();
}

/** Arguments a command takes, or undefined when it takes none */
export const commandSchema = (c: Command) => c.params ?? commandParams(c.id);

/**
 * Runs a command and returns its result. With `args`, a command that takes arguments applies them
 * without opening its dialog; a wrong argument throws
 */
export function runCommand(id: string, args?: FormValues) {
  const c = cmd(id);
  if (!available(c)) return;
  const apply = c.apply ?? PARAMETRIC[c.id]?.apply;
  const schema = commandSchema(c);
  if (args && apply && schema) return apply(commandArgs(schema, args));
  return c.run();
}
