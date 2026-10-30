import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildIndex, SRC } from './extensions';

/** These products package from their own source folders, independently of the editor build. */
test('AI assistant and game-rig remain independent catalog artifacts after relocating their sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixprite-artifacts-'));
  try {
    for (const id of ['ai-assistant', 'game-rig', 'template']) await cp(join(SRC, id), join(root, id), { recursive: true });
    const { registry, problems } = buildIndex(root, [], { publicOnly: true, base: 'https://example.test/pinned-commit/' });
    expect(problems).toEqual([]);
    expect(registry.extensions.map(e => e.id)).toEqual(['ai-assistant', 'game-rig']);
    for (const entry of registry.extensions) {
      expect(entry.path).toBe(`https://example.test/pinned-commit/${entry.id}/`);
      expect(entry.files['manifest.json']).toBeDefined();
      expect(Object.keys(entry.files).some(name => /^src\/.+\.ts$/.test(name))).toBe(true);
      expect(Object.keys(entry.files).some(name => /^(node_modules|tsconfig|package\.json|\.\.)/.test(name))).toBe(false);
      for (const [file, integrity] of Object.entries(entry.files)) {
        const source = await readFile(join(root, entry.id, file));
        expect(integrity).toBe('sha256-' + createHash('sha256').update(source).digest('base64'));
        if (file.endsWith('.ts')) expect(source.toString()).not.toMatch(/(?:from\s*|import\s*\()\s*['"](?:~\/|.*\/src\/core\/)/);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
