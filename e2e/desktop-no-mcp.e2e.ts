import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './desktop-helper';

test('--no-mcp starts the real editor without a server despite saved automatic startup', async () => {
  const f = await nativeFixture();
  try {
    await mkdir(f.profile, { recursive: true });
    await writeFile(join(f.profile, 'window.json'), JSON.stringify({ mcpEnabled: true, mcpPort: 0 }));
    await f.launch([], ['--no-mcp']);
    await expect(readFile(f.connection)).rejects.toThrow();
    await expect(readFile(join(f.profile, 'mcp-token.json'))).rejects.toThrow();
    const saved = JSON.parse(await readFile(join(f.profile, 'window.json'), 'utf8'));
    expect(saved).toMatchObject({ mcpEnabled: true, mcpPort: 0, session: { tabs: [] } });
  } finally { await f.dispose(); }
});

test('--no-mcp forwarded to an open editor stops only MCP and preserves its settings', async () => {
  const f = await nativeFixture();
  try {
    await mkdir(f.profile, { recursive: true });
    await writeFile(join(f.profile, 'window.json'), JSON.stringify({ mcpEnabled: true, mcpPort: 0 }));
    const gui = await f.launch();
    const before = JSON.parse(await readFile(f.connection, 'utf8'));
    const disabled = await f.launch([], ['--no-mcp']);
    await expect.poll(() => disabled.exitCode, { intervals: [50, 100, 200] }).toBe(0);
    await expect.poll(async () => { try { await readFile(f.connection); return false; } catch { return true; } }, { intervals: [20, 50, 100] }).toBe(true);
    const response = await fetch(before.mcpUrl).catch(() => null);
    expect(response === null || !response.ok).toBe(true);
    expect(() => process.kill(gui.pid!, 0)).not.toThrow();
    expect(JSON.parse(await readFile(join(f.profile, 'window.json'), 'utf8'))).toMatchObject({ mcpEnabled: true, mcpPort: 0 });
    await f.launch();
    expect(JSON.parse(await readFile(f.connection, 'utf8')).pid).toBe(gui.pid);
    expect((await f.call('desktop_info')).windows).toBe(1);
  } finally { await f.dispose(); }
});
