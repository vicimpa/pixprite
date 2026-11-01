import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { nativeFixture } from './desktop-helper';

test('MCP is off by default and launch flags enable it in the editor process without changing preferences', async () => {
  const f = await nativeFixture();
  try {
    await f.launch([], [], false);
    await expect(readFile(f.connection)).rejects.toThrow();
    await f.stop();
    const gui = await f.launch();
    const info = JSON.parse(await readFile(f.connection, 'utf8'));
    expect(info.pid).toBe(gui.pid);
    const saved = JSON.parse(await readFile(join(f.profile, 'window.json'), 'utf8'));
    expect(saved.mcpEnabled ?? false).toBe(false);
    expect(saved).not.toHaveProperty('mcpPort');
  } finally { await f.dispose(); }
});

test('a launch port overrides the saved port without changing it and saved auto-start works without flags', async () => {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const f = await nativeFixture();
  try {
    await mkdir(f.profile, { recursive: true });
    await writeFile(join(f.profile, 'window.json'), JSON.stringify({ mcpEnabled: true, mcpPort: 0 }));
    const gui = await f.launch([], ['--mcp', '--mcp-port', String(port)]);
    const info = JSON.parse(await readFile(f.connection, 'utf8'));
    expect(info).toMatchObject({ pid: gui.pid, port, mcpUrl: `http://127.0.0.1:${port}/mcp` });
    expect(JSON.parse(await readFile(join(f.profile, 'window.json'), 'utf8')).mcpPort).toBe(0);
    await f.stop(); await f.launch([], []);
    expect((await f.call('desktop_info')).windows).toBe(1);
  } finally { await f.dispose(); }
});

test('repeated launches open files in the existing editor and preserve its unsaved document', async () => {
  const f = await nativeFixture();
  try {
    const gui = await f.launch();
    const original = JSON.parse(await readFile(f.connection, 'utf8'));
    const doc = await f.call('create', { width: 8, height: 8, name: 'Existing editor' });
    const path = join(f.directory, 'opened-again.pixprite');
    await f.call('save_file', { path });
    await f.call('pixels', { action: 'write', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#ff3366ff' });
    const second = await f.launch([basename(path)], ['--mcp', '--mcp-port', '1'], true, f.directory);
    await expect.poll(async () => (await f.call('documents')).documents.length, { intervals: [50, 100, 200] }).toBe(2);
    await expect.poll(() => second.exitCode, { intervals: [50, 100, 200] }).toBe(0);
    expect((await f.call('desktop_info')).windows).toBe(1);
    expect(JSON.parse(await readFile(f.connection, 'utf8'))).toMatchObject({ pid: gui.pid, port: original.port });
    await f.call('select', { id: doc.id });
    const pixels = await f.call('pixels', { action: 'read', rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect([...Buffer.from(pixels.data, 'base64')]).toEqual([255, 51, 102, 255]);
    await expect(f.call('window_new')).rejects.toThrow('Unknown');
    expect((await f.call('commands', { filter: 'newWindow' }))).toEqual([]);
    expect((await f.call('desktop_info')).windows).toBe(1);
  } finally { await f.dispose(); }
});

test('closing the single editor stops its MCP server without an idle process', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    const info = JSON.parse(await readFile(f.connection, 'utf8'));
    try { await f.call('window_action', { action: 'close' }); } catch { /* Window and server may close before the reply. */ }
    await expect.poll(async () => {
      try { await readFile(f.connection); return false; } catch { return true; }
    }, { timeout: 5000, intervals: [20, 50, 100] }).toBe(true);
    const response = await fetch(info.mcpUrl).catch(() => null);
    expect(response === null || !response.ok).toBe(true);
  } finally { await f.dispose(); }
});

test('sessions from former windows are merged into the single editor without losing tabs', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    await f.call('create', { width: 8, height: 8, name: 'Former window A' });
    await f.call('create', { width: 16, height: 16, name: 'Former window B' });
    await f.stop();
    const path = join(f.profile, 'window.json');
    const config = JSON.parse(await readFile(path, 'utf8'));
    const [a, b] = config.session.tabs;
    const former = `editor-${randomUUID()}`;
    config.sessions = { main: { tabs: [a], active: a }, [former]: { tabs: [b], active: b } };
    config.openWindows = ['main', former]; delete config.session;
    await writeFile(path, JSON.stringify(config));
    await f.launch();
    expect((await f.call('documents')).documents.map((doc: any) => doc.name)).toEqual(['Former window A', 'Former window B']);
    expect((await f.call('desktop_info')).windows).toBe(1);
    await f.stop(); await f.launch();
    expect((await f.call('documents')).documents).toHaveLength(2);
  } finally { await f.dispose(); }
});
