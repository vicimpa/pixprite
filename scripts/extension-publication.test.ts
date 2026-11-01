import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishExtensions } from './publish-extensions';

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
});
