import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishExtensions } from './publish-extensions';
import { compareVersions } from '../src/core/extensions/versions';

test('shared automation packages require 0.0.6 while historical package bytes and tags stay immutable', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pixprite-assistant-releases-')), out = join(temp, 'pub'), root = join(temp, 'src');
  const folder = join(root, 'ai-assistant');
  mkdirSync(out); mkdirSync(folder, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', out, ...args], { encoding: 'utf8' }).trim();
  const manifest = (version: string, minEditorVersion: string) => writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'ai-assistant', name: 'Assistant', version, minEditorVersion, apiVersion: 1, entry: 'main.js' }));
  try {
    git('init', '-b', 'extensions'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    writeFileSync(join(folder, 'main.js'), 'export default 1;');
    manifest('0.3.0', '0.0.5'); publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'old', root);
    manifest('0.4.0', '0.0.5');
    const first = publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'shared', root);
    const original = git('rev-parse', 'ext-ai-assistant-v0.4.0^{commit}');
    const bytes = git('show', `${original}:ai-assistant/manifest.json`);
    const stale = JSON.parse(readFileSync(join(out, 'registry.json'), 'utf8'));
    stale.extensions[0].minEditorVersion = '0.0.5';
    stale.extensions[0].versions.find((v: { version: string }) => v.version === '0.4.0').minEditorVersion = '0.0.5';
    writeFileSync(join(out, 'registry.json'), JSON.stringify(stale)); git('add', '-A'); git('commit', '-m', 'Legacy incorrect compatibility');
    manifest('0.4.1', '0.0.6');
    const next = publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'fixed', root).extensions[0];
    expect(next.minEditorVersion).toBe('0.0.6');
    const historical = next.versions.find(v => v.version === '0.4.0')!;
    expect(historical.minEditorVersion).toBe('0.0.6');
    expect(historical.path).toBe(first.extensions[0].path);
    expect(git('rev-parse', 'ext-ai-assistant-v0.4.0^{commit}')).toBe(original);
    expect(git('show', `${original}:ai-assistant/manifest.json`)).toBe(bytes);
    expect(next.versions.find(v => compareVersions('0.0.5', v.minEditorVersion ?? '0.0.0') >= 0)?.version).toBe('0.3.0');
    expect(next.versions.find(v => compareVersions('0.0.6', v.minEditorVersion ?? '0.0.0') >= 0)?.version).toBe('0.4.1');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 30_000);

test('publication retains immutable packages and tags, backfills history and rejects a rewritten version', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pixprite-releases-')), out = join(temp, 'pub'), root = join(temp, 'src');
  mkdirSync(out); mkdirSync(join(root, 'demo'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', out, ...args], { encoding: 'utf8' }).trim();
  const manifest = (version: string) => writeFileSync(join(root, 'demo', 'manifest.json'), JSON.stringify({ id: 'demo', name: 'Demo', version, apiVersion: 1, category: 'tools', tags: ['pixel-art'], entry: 'main.js' }));
  try {
    git('init', '-b', 'extensions'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    manifest('1.0.0'); writeFileSync(join(root, 'demo', 'main.js'), 'export default 1;');
    const first = publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'first', root);
    const old = first.extensions[0].path, tag = git('rev-parse', 'ext-demo-v1.0.0^{commit}');
    expect(git('show', `${tag}:demo/main.js`)).toBe('export default 1;');
    expect(publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'same', root).extensions[0].path).toBe(old);
    manifest('1.1.0'); writeFileSync(join(root, 'demo', 'main.js'), 'export default 2;');
    const second = publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'second', root);
    expect(second.extensions[0].versions.map(v => v.version)).toEqual(['1.1.0', '1.0.0']);
    expect(second.extensions[0].versions[1].path).toBe(old);
    expect(git('rev-parse', 'ext-demo-v1.0.0^{commit}')).toBe(tag);
    expect(JSON.parse(readFileSync(join(out, 'registry.json'), 'utf8')).version).toBe(3);
    writeFileSync(join(root, 'demo', 'main.js'), 'export default 3;');
    const before = git('rev-parse', 'HEAD');
    expect(() => publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'bad', root)).toThrow('bump its version');
    expect(git('rev-parse', 'HEAD')).toBe(before);
    // Removing history from a catalog does not discard versions in older Git catalog commits.
    manifest('1.2.0');
    const json = JSON.parse(readFileSync(join(out, 'registry.json'), 'utf8')); delete json.extensions[0].versions;
    writeFileSync(join(out, 'registry.json'), JSON.stringify(json)); git('add', '-A'); git('commit', '-m', 'Legacy catalog');
    expect(publishExtensions(out, 'https://cdn.example.test/gh/test/repo', 'third', root).extensions[0].versions.map(v => v.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 30_000);
