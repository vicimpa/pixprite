import { expect, test } from 'bun:test';
import { parseIconPack } from './iconPack';
import { DEFAULT_ICON_PACK, PIXEL_ICON_PACK, registerIconPack, iconPacks, iconArtwork, iconPackChoices, resolveIconPack } from '../IconPacks';
import { validateManifest } from './manifest';
import { ICONS } from '../../ui/Icon/icons';
import outline from '../../ui/Icon/outline.json';
import duotone from '../../../extensions/icons-duotone/icons.json';

test('both shipped icon packs cover every semantic icon with valid artwork', () => {
  const pixel = Object.fromEntries(Object.entries(ICONS).map(([name, pixels]) => {
    const rows = pixels.trim().split('\n').map(row => row.trim());
    const width = Math.max(...rows.map(row => row.length));
    return [name, { pixels: rows.map(row => row.padEnd(width, '.')).join('\n') }];
  }));
  for (const pack of [pixel, outline]) expect(Object.keys(parseIconPack(pack)).sort()).toEqual(Object.keys(ICONS).sort());
});

test('outline is the default, both built-ins are always available, and existing pixel choices are retained', () => {
  expect(DEFAULT_ICON_PACK).toBe('outline');
  expect(iconPackChoices(key => key).map(([id]) => id)).toEqual([DEFAULT_ICON_PACK, PIXEL_ICON_PACK]);
  expect(resolveIconPack('builtin')).toBe(PIXEL_ICON_PACK);
  expect(resolveIconPack('icons-pixel:pixel')).toBe(PIXEL_ICON_PACK);
  expect(resolveIconPack('icons-outline:outline')).toBe(DEFAULT_ICON_PACK);
  expect(resolveIconPack('missing:pack')).toBe(DEFAULT_ICON_PACK);
  expect(iconArtwork(PIXEL_ICON_PACK, 'pencil')).toBeUndefined();
  expect(() => registerIconPack(DEFAULT_ICON_PACK, () => 'Override', duotone)).toThrow('Reserved built-in');
});

test('the partial duotone example has its own artwork and inherits missing icons from Outline', () => {
  const parsed = parseIconPack(duotone);
  expect(Object.keys(parsed)).toHaveLength(16);
  for (const name of Object.keys(parsed)) expect(name in ICONS).toBe(true);
  const off = registerIconPack('icons-duotone:duotone', () => 'Duotone', duotone);
  try {
    expect(iconArtwork('icons-duotone:duotone', 'pencil')).toEqual(parsed.pencil);
    expect(iconArtwork('icons-duotone:duotone', 'pencil')).not.toEqual(iconArtwork(DEFAULT_ICON_PACK, 'pencil'));
    expect(iconArtwork('icons-duotone:duotone', 'pause')).toEqual(iconArtwork(DEFAULT_ICON_PACK, 'pause'));
  } finally { off(); }
  expect(iconArtwork('icons-duotone:duotone', 'pencil')).toEqual(iconArtwork(DEFAULT_ICON_PACK, 'pencil'));
});

test('icon packs accept partial theme-aware artwork and reject active or unbounded content', () => {
  expect(parseIconPack({ pencil: { size: 24, paths: [{ d: 'M3 21 21 3', stroke: 'accent' }] } }).pencil).toHaveProperty('size', 24);
  const invalid = [null, [], {}, { pencil: '<svg onload="alert(1)" />' },
    { pencil: { pixels: '#.\n#' } }, { pencil: { pixels: '#'.repeat(65) } },
    { pencil: { pixels: '#', onload: 'alert(1)' } }, { pencil: { size: Infinity, paths: [] } },
    { pencil: { size: 24, paths: [{ d: 'M0 0', fill: 'url(https://evil.test)' }] } },
    { pencil: { size: 24, paths: [{ d: '<script>alert(1)</script>' }] } },
    { pencil: { size: 24, paths: [{ d: 'M0 0', onclick: 'alert(1)' }] } },
    { pencil: { size: 24, paths: [{ d: 'M1e99 0' }] } },
    { pencil: { size: 24, paths: [{ d: 'M0 0', strokeWidth: -1 }] } },
    { pencil: { size: 24, paths: Array(65).fill({ d: 'M0 0' }) } },
  ];
  for (const data of invalid) expect(() => parseIconPack(data)).toThrow('Icon pack:');
});

test('disposing a pack preserves another registration with the same id', () => {
  const first = registerIconPack('test:icons', () => 'First', { pencil: { pixels: '#' } });
  const second = registerIconPack('test:icons', () => 'Second', { pencil: { pixels: '+' } });
  first();
  expect(iconPacks.peek().get('test:icons')?.label()).toBe('Second');
  second();
  expect(iconPacks.peek().has('test:icons')).toBe(false);
});

test('data-only icon pack manifests require safe package paths and unique contribution ids', () => {
  const base = { id: 'test-icons', name: 'Test icons', version: '1.0.0', apiVersion: 1 };
  const pack = { id: 'outline', label: 'Outline', icons: 'icons.json' };
  expect(validateManifest({ ...base, contributes: { iconPacks: [pack] } })).toEqual([]);
  expect(validateManifest({ ...base, contributes: { iconPacks: [pack, pack] } })).toContain('contributes.iconPacks[1]: duplicate id "outline"');
});
