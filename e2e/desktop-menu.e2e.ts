import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { nativeFixture } from './desktop-helper';

test('native shell has no menu and authenticates every loopback request', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    expect(await f.call('desktop_info')).toMatchObject({ runtime: 'tauri', windows: 1, menu: false });
    const { url, token } = JSON.parse(await readFile(f.connection, 'utf8'));
    for (const headers of ([{}, { Authorization: 'Bearer invalid' }, { Authorization: `Bearer ${token}`, Origin: 'https://example.com' }] as Record<string, string>[])) {
      expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ method: 'documents' }) })).status).toBe(403);
    }
    if (process.platform !== 'win32') expect((await stat(f.connection)).mode & 0o777).toBe(0o600);
    await expect(f.call('open_file', { path: '/etc/passwd' })).rejects.toThrow('supported');
    await expect(f.call('window_action', { action: 'detach' })).rejects.toThrow('Unknown');
  } finally { await f.dispose(); }
});
