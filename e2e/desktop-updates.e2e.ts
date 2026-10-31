import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './desktop-helper';

async function releaseFixture() {
  let release: unknown = { tag_name: 'v999.0.0', draft: false, prerelease: false }, status = 200;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!); response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(release));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const f = await nativeFixture({ PIXPRITE_DISABLE_UPDATES: '0', PIXPRITE_UPDATE_URL: `http://127.0.0.1:${port}/latest` });
  return { ...f, requests,
    respond(value: unknown, code = 200) { release = value; status = code; },
    async dispose() { await f.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('release checks run after startup and only announce the new version', async () => {
  const f = await releaseFixture();
  try {
    await f.launch(); expect(f.requests).toEqual([]);
    await f.call('create', { width: 4, height: 4, name: 'Keep editing' });
    // Keep background discovery independent of foreground rendering and desktop focus.
    await f.call('window_action', { action: 'minimize' });
    const before = await f.call('desktop_info');
    const pid = JSON.parse(await readFile(f.connection, 'utf8')).pid;
    await expect.poll(() => f.call('update_state'), { timeout: 25_000 }).toMatchObject({
      currentVersion: before.version, version: '999.0.0', url: 'https://github.com/vicimpa/pixprite/releases/tag/v999.0.0',
    });
    expect(f.requests).toEqual(['/latest']); // no installer or content requests
    expect(JSON.parse(await readFile(f.connection, 'utf8')).pid).toBe(pid);
    expect((await f.call('desktop_info')).version).toBe(before.version);
    expect((await f.call('inspect')).name).toBe('Keep editing');
    expect(await readdir(f.profile)).not.toContain('updates');
    await expect(f.call('update_action', { action: 'restart' })).rejects.toThrow('Unknown');
  } finally { await f.dispose(); }
});

test('network errors preserve an existing announcement without downloading or stopping editing', async () => {
  const f = await releaseFixture();
  try {
    await f.launch(); await f.call('update_action', { action: 'check' });
    const available = await f.call('update_state');
    f.respond({ message: 'rate limited' }, 403);
    await expect(f.call('update_action', { action: 'check' })).rejects.toThrow();
    expect(await f.call('update_state')).toEqual(available);
    await f.call('create', { width: 4, height: 4, name: 'Offline edits' });
    expect((await f.call('inspect')).name).toBe('Offline edits');
  } finally { await f.dispose(); }
});

test('old content caches are ignored and unpublished releases produce no notice', async () => {
  const f = await releaseFixture();
  try {
    const cache = join(f.profile, 'updates'); await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'active.json'), JSON.stringify({ meta: { version: '999.0.0', shell: 2, runtime: 'a'.repeat(64) } }));
    await writeFile(join(cache, 'trial.json'), 'old trial');
    f.respond({ message: 'Not Found' }, 404);
    await f.launch(); await f.call('update_action', { action: 'check' });
    expect(await f.call('update_state')).toEqual({ currentVersion: (await f.call('desktop_info')).version });
    expect(await readFile(join(cache, 'trial.json'), 'utf8')).toBe('old trial');
  } finally { await f.dispose(); }
});
