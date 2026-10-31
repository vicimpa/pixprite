import { available, cmd, COMMANDS, commandLabel } from "~/core/Commands";
import { prettyCombo } from "~/core/Hotkeys";
import { LANGUAGES, t } from "~/core/i18n";
import { THEMES } from "~/core/Themes";
import { LAYOUT_PRESETS, state } from "~/core/State";
import { LogoMark } from "~/ui/Logo";
import { askText } from "~/ui/Dialog";
import { extensionMenuItems, extensionPanelItems, updates } from "~/modules/Extensions";
import { openProblems } from "~/modules/Problems";
import { MenuBar, type MenuEntry, type MenuItems } from "~/ui/Menu";
import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";
import styled from "styled-components";

export function item(id: string, label?: string): MenuEntry {
  const c = cmd(id);
  return {
    label: label ?? commandLabel(c),
    shortcut: prettyCombo(c.keys?.[0]),
    disabled: !available(c),
    checked: c.checked?.(),
    run: c.run,
  };
}

const sub = (label: string, items: MenuItems): MenuEntry => ({ label, items });

/** Built-in layouts keep their English name as the id (it is stored); the menu shows it translated */
const layoutName = (n: string) => n in LAYOUT_PRESETS ? t(`layout.${n.toLowerCase()}`) : n;

/** The store and installed list, then what extensions add: panels to show and their own commands */
function extensionsMenu(editor: boolean): MenuItems {
  const own = COMMANDS.filter(c => c.ext && c.group === 'menu.extensions').map(c => item(c.id));
  return [
    item('extensions.openStore'),
    updates.value.size ? item('extensions.openInstalled', `${commandLabel(cmd('extensions.openInstalled'))} (${t('extensions.updatesCount', { count: updates.value.size })})`) : item('extensions.openInstalled'),
    editor && { label: t('problems.menu'), run: () => openProblems() },
    editor && extensionPanelItems().length > 0 && '-',
    ...(editor ? extensionPanelItems() : []),
    own.length > 0 && '-',
    ...own,
  ];
}

/** Top-level `label`s are text keys, translated by the menu bar */
const MENUS: { label: string; items: () => MenuItems; }[] = [
  {
    label: 'menu.file', items: () => [
      item('file.new'), item('file.open', t('menu.openProjectAsepriteImage')), item('file.importSheet'), item('file.importLayer'), item('file.importFrames'), '-',
      item('file.save'), item('file.saveAs'), item('file.download'), '-', item('file.duplicate'), item('file.close'), '-',
      item('file.export'), item('file.repeatExport'), item('file.exportPng'), '-',
      item('file.savePalette'),
    ]
  },
  {
    label: 'menu.edit', items: () => [
      item('edit.undo'), item('edit.redo'), item('edit.history'), '-',
      item('edit.cut'), item('edit.copy'), item('edit.copyMerged'), item('edit.paste'), item('edit.pasteAsLayer'), item('edit.clear'), item('edit.fill'), item('edit.fillWithBrush'), item('edit.strokeSelection'), '-',
      sub(t('menu.transform'), [item('edit.flipH'), item('edit.flipV'), '-', item('edit.rotateCw'), item('edit.rotateCcw'), item('edit.rotate180')]),
      sub(t('common.colors'), [item('edit.replaceColor'), item('edit.adjust'), item('fx.curves'), item('fx.negative'), item('fx.posterize'), item('fx.brightness'), item('edit.invert', t('menu.negativeInstant')), item('edit.grayscale')]),
      sub(t('menu.effects'), [item('fx.outline'), item('fx.shadow'), '-', item('fx.convolution'), item('fx.median'), item('fx.noise'), item('fx.pixelate'), '-', item('fx.offset')]),
      '-', item('edit.brushFromSelection'), item('edit.discardBrush'),
      '-', item('edit.prefs'),
    ]
  },
  {
    label: 'menu.image', items: () => [
      item('image.properties'), item('image.colorMode'), '-',
      item('image.canvasSize'), item('image.spriteSize'), '-',
      sub(t('menu.rotateCanvas'), [item('image.rotateCw', '90° right'), item('image.rotateCcw', '90° left'), item('image.rotate180', '180°')]),
      sub(t('menu.mirrorCanvas'), [item('image.flipH', t('menu.horizontally')), item('image.flipV', t('menu.vertically'))]),
      '-', item('image.crop'), item('image.trim'),
    ]
  },
  {
    label: 'menu.layer', items: () => [
      item('layer.new'), item('layer.newBelow'), item('layer.newGroup'), item('layer.duplicate'), item('layer.delete'), '-',
      item('layer.ungroup'), item('layer.outOfGroup'), '-',
      item('layer.newTilemap'), item('layer.toTilemap'), item('layer.toPixels'), item('layer.changeTileset'), '-',
      item('layer.properties'), item('layer.visible'), item('layer.lock'), item('layer.continuous'), item('layer.clip'), item('layer.solo'), item('layer.reference'), '-',
      item('layer.toBackground'), item('layer.fromBackground'), '-',
      item('layer.up'), item('layer.down'), '-',
      item('layer.mergeDown'), item('layer.mergeSelected'), item('layer.mergeVisible'), item('layer.flatten'),
    ]
  },
  {
    label: 'menu.animation', items: () => [
      item('anim.play'), item('anim.onion'), '-',
      item('anim.newFrame'), item('anim.newEmptyFrame'), item('anim.deleteFrame'), item('anim.tween'), '-',
      item('anim.frameProperties'), item('anim.moveLeft'), item('anim.moveRight'), item('anim.reverse'), '-',
      sub(t('menu.cels'), [item('cel.properties'), '-', item('cel.duplicate'), item('cel.duplicateLinked'), item('cel.link'), item('cel.unlink'), '-', item('cel.clear')]),
      item('anim.newTag'), item('anim.loop'), '-',
      sub(t('menu.goTo'), [item('anim.first'), item('anim.prev'), item('anim.next'), item('anim.prevInTag'), item('anim.nextInTag'), item('anim.last'), '-', item('anim.goto')]),
    ]
  },
  {
    label: 'menu.select', items: () => [
      item('select.all'), item('select.none'), item('select.reselect'), item('select.invert'), '-',
      item('select.content'), item('select.alpha'), item('select.color'), '-',
      item('select.grow'), item('select.shrink'), item('select.border'), '-',
      item('select.drop'), item('select.cancelTransform'), '-',
      item('select.gridAsSelection'),
    ]
  },
  {
    label: 'menu.view', items: () => [
      item('view.zoomIn'), item('view.zoomOut'), item('view.actual'), item('view.fit'), item('view.center'), '-',
      item('view.pixelGrid'), item('view.grid'), item('view.layerEdges'), item('view.slices'), item('view.hints'), item('view.commandPalette'), item('view.snap'), item('view.gridSettings'), '-',
      sub(t('menu.wrapAround'), [item('view.tileX'), item('view.tileY')]),
      sub(t('menu.mirrorDrawing'), [item('view.symX'), item('view.symY')]),
      sub(t('common.guides'), [item('view.rulers'), item('view.guideV'), item('view.guideH'), item('view.clearGuides'), item('view.lockGuides'), item('view.snapGuides')]),
      item('view.flip'),
      '-', item('view.preview'), item('view.fullscreenPreview'),
    ]
  },
  {
    label: 'menu.window', items: () => [
      item('window.toolbar'), item('window.colors'), item('window.timeline'), item('window.options'), item('window.status'), '-',
      sub(t('common.arrange'), [
        item('window.toolbarLeft'), item('window.toolbarRight'), '-',
        item('window.colorsLeft'), item('window.colorsRight'), '-',
        item('window.timelineBottom'), item('window.timelineTop'),
      ]),
      sub(t('menu.layouts'), [
        ...Object.keys(LAYOUT_PRESETS).map(n => ({
          label: layoutName(n) + (state.layoutName === n && state.layoutModified ? ' *' : ''),
          checked: state.layoutName === n,
          run: () => state.applyLayout(n),
        })),
        Object.keys(state.savedLayouts).length > 0 && '-',
        ...Object.keys(state.savedLayouts).map(n => ({ label: n, checked: state.layoutName === n, run: () => state.applyLayout(n) })),
        '-',
        {
          label: t('menu.saveCurrentAs'), run: async () => {
            const name = await askText(t('menu.nameForThisLayout'), '', { title: t('menu.saveCurrentAs'), ok: t('common.save') });
            if (name && !state.saveLayoutAs(name)) state.showTip(t('menu.thatNameIsTaken'));
          },
        },
        state.layoutModified && { label: t('menu.restoreLayout', { name: layoutName(state.layoutName) }), run: () => state.applyLayout(state.layoutName) },
        Object.keys(state.savedLayouts).length > 0 && sub(t('common.delete'), Object.keys(state.savedLayouts).map(n => ({ label: n, run: () => state.deleteLayout(n) }))),
      ]),
      sub(t('common.theme'), Object.keys(THEMES).map(id => item(`window.theme.${id}`))),
      sub(t('common.language'), Object.keys(LANGUAGES).map(id => item(`window.lang.${id}`))),
      '-', item('window.focus'), item('window.reset'),
    ]
  },
  { label: 'menu.extensions', items: () => extensionsMenu(true) },
  {
    label: 'menu.help', items: () => [item('help.shortcuts', t('common.keyboardShortcutsMenu')), '-', item('help.github'), item('help.about')]
  },
];

const Title = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: var(--fg-dim);
  white-space: nowrap;
  overflow: hidden;
`;

const Logo = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
  margin-right: 6px;
`;

/** On the home page only what works without an open document */
const HOME_MENUS: { label: string; items: () => MenuItems; }[] = [
  { label: 'menu.file', items: () => [item('file.new'), item('file.open', t('menu.openProjectAsepriteImage')), item('file.importSheet'), '-', item('edit.prefs')] },
  {
    label: 'menu.window', items: () => [
      sub(t('common.theme'), Object.keys(THEMES).map(id => item(`window.theme.${id}`))),
      sub(t('common.language'), Object.keys(LANGUAGES).map(id => item(`window.lang.${id}`))),
      '-', item('window.fullscreen'), item('view.commandPalette'),
    ]
  },
  { label: 'menu.extensions', items: () => extensionsMenu(false) },
  { label: 'menu.help', items: () => [item('help.shortcuts', t('common.keyboardShortcutsMenu')), '-', item('help.github'), item('help.about')] },
];

/** Commands extensions put in a main menu (`menu: 'file'`…) come last in it */
// The Extensions menu lists its commands itself
const withExtensions = MENUS.map(m => m.label === 'menu.extensions' ? m : ({ ...m, items: () => [...m.items(), ...extensionMenuItems(m.label.replace(/^menu\./, ''))] }));

export const MainMenu: FC = () => {
  useSignals();
  const { sprite } = state;
  return (
    <MenuBar key={state.home ? 'home' : 'editor'} menus={state.home ? HOME_MENUS : withExtensions}>
      <Title><Logo><LogoMark size={16} />Pixprite</Logo>{!state.home && `${sprite.name} · ${sprite.width}×${sprite.height}`}</Title>
    </MenuBar>
  );
};
