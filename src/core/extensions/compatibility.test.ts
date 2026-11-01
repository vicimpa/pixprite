import { expect, test } from 'bun:test';
import { compatibilityError } from './compatibility';
import { compareVersions, isVersion } from './versions';
import { validateManifest } from './manifest';

test('editor minimums compare SemVer, including numeric prereleases and build metadata', () => {
  const ordered = ['0.0.3', '0.0.4-alpha', '0.0.4-alpha.2', '0.0.4-alpha.10', '0.0.4-beta', '0.0.4-rc.1', '0.0.4', '0.0.10', '0.1.0', '1.0.0'];
  for (let i = 1; i < ordered.length; i++) {
    expect(compareVersions(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
    expect(compareVersions(ordered[i - 1], ordered[i])).toBeLessThan(0);
    expect(compatibilityError({ minEditorVersion: ordered[i] }, ordered[i - 1])).toContain('Requires Pixprite');
  }
  expect(compareVersions('0.0.4+build.2', '0.0.4+build.1')).toBe(0);
  expect(compatibilityError({ minEditorVersion: '0.0.4' }, '0.0.4+dev')).toBeNull();
  expect(compatibilityError({}, '0.0.1')).toBeNull();
  expect(compatibilityError({ minEditorVersion: '0.0.4' }, '')).toContain('unknown');
});

test('manifest minimum is optional but malformed versions and ranges fail closed', () => {
  const base = { id: 'compatible', name: 'Compatible', version: '1.0.0', apiVersion: 1 };
  expect(validateManifest(base)).toEqual([]);
  for (const minimum of ['0.0.4', '1.2.3-rc.1+build.2']) {
    expect(isVersion(minimum)).toBe(true);
    expect(validateManifest({ ...base, minEditorVersion: minimum })).toEqual([]);
  }
  for (const minimum of ['', '>=0.0.4', '1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3-', null, 4]) {
    expect(isVersion(minimum)).toBe(false);
    expect(validateManifest({ ...base, minEditorVersion: minimum })).toContain('minEditorVersion: semver expected');
  }
});

test('categories and tags are optional for legacy manifests and validated for new packages', () => {
  const base = { id: 'metadata', name: 'Metadata', version: '1.0.0', apiVersion: 1 };
  expect(validateManifest({ ...base, category: 'animation', tags: ['rig', 'game-development'] })).toEqual([]);
  for (const extra of [{ category: 'unknown' }, { tags: ['ai', 'ai'] }, { tags: ['has spaces'] }, { tags: [42] }, { tags: Array.from({ length: 17 }, (_, i) => `tag-${i}`) }]) {
    expect(validateManifest({ ...base, ...extra }).length).toBeGreaterThan(0);
  }
});
