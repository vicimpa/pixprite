import { expect, test } from '@playwright/test';
import { nativeFixture } from './desktop-helper';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { callDesktop } from '../desktop/connection';

test('native editor is controlled end to end through the standalone stdio MCP server', async () => {
  test.setTimeout(90_000);
  const f = await nativeFixture();
  const { directory, connection } = f;
  await f.launch();
  const client = spawn(process.execPath, [resolve('dist/desktop/mcp.mjs'), '--connection', connection], { stdio: ['pipe', 'pipe', 'pipe'] });
  let serial = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const logs: string[] = [];
  client.stderr.on('data', chunk => logs.push(String(chunk)));
  const lines = createInterface({ input: client.stdout });
  lines.on('line', line => {
    const reply = JSON.parse(line);
    const task = pending.get(reply.id);
    if (task) { pending.delete(reply.id); if (reply.error) task.reject(new Error(JSON.stringify(reply.error))); else task.resolve(reply.result); }
  });
  client.on('exit', code => { for (const task of pending.values()) task.reject(new Error(`MCP exited ${code}: ${logs.join('')}`)); pending.clear(); });
  function rpc(method: string, params: unknown) {
    const id = ++serial;
    return new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject }); client.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  async function tool(name: string, args = {}) {
    const reply = await rpc('tools/call', { name, arguments: args });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    return reply.content[0].type === 'image' ? reply.content[0] : JSON.parse(reply.content[0].text);
  }
  try {
    expect(await f.call('desktop_info')).toMatchObject({ runtime: 'tauri', windows: 1, menu: false });
    await expect.poll(() => callDesktop({ method: 'documents' }, connection)).toMatchObject({ documents: [] });
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pixprite-e2e', version: '1' } });
    expect(initialized.serverInfo.name).toBe('pixprite');
    expect(initialized.serverInfo.version).toBe(JSON.parse(await readFile(resolve('package.json'), 'utf8')).version);
    client.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    expect((await rpc('tools/list', {})).tools.map((tool: { name: string }) => tool.name)).toContain('pixprite_pixels');
    const created = await tool('pixprite_create', { width: 8, height: 8, name: 'MCP round trip' });
    expect(created.width).toBe(8);
    await tool('pixprite_pixels', { action: 'write', rect: { x: 1, y: 2, w: 2, h: 1 }, fill: '#ff008080' });
    const pixels = await tool('pixprite_pixels', { action: 'read', rect: { x: 1, y: 2, w: 2, h: 1 } });
    expect([...Buffer.from(pixels.data, 'base64')]).toEqual([255, 0, 128, 128, 255, 0, 128, 128]);
    await tool('pixprite_history', { action: 'undo' });
    expect(Buffer.from((await tool('pixprite_pixels', { action: 'read', rect: { x: 1, y: 2, w: 2, h: 1 } })).data, 'base64').every(byte => byte === 0)).toBe(true);
    await tool('pixprite_history', { action: 'redo' });
    await tool('pixprite_edit', { operations: [{ method: 'sprite.layers.add', args: [{ name: 'MCP layer' }] }, { method: 'sprite.frames.add', args: [1, { copy: true, duration: 150 }] }] });
    expect((await tool('pixprite_inspect')).layers).toHaveLength(2);
    const rejected = await rpc('tools/call', { name: 'pixprite_edit', arguments: { operations: [{ method: 'sprite.layers.add', args: [{ name: 'rollback' }] }, { method: 'sprite.frames.remove', args: [999] }] } });
    expect(rejected.isError).toBe(true);
    expect((await tool('pixprite_inspect')).layers).toHaveLength(2);
    const commands = await tool('pixprite_commands', { filter: 'canvasSize' });
    expect(commands[0].params.length).toBeGreaterThan(0);
    await tool('pixprite_run_command', { id: 'image.canvasSize', args: { width: 10, height: 10, anchorX: 0, anchorY: 0 } });
    expect((await tool('pixprite_inspect')).width).toBe(10);
    const pacing = await tool('pixprite_performance', { durationMs: 150 });
    expect(pacing.scope).toContain('requestAnimationFrame');
    expect(pacing.elapsedMs).toBeGreaterThanOrEqual(140);
    expect(Array.isArray(pacing.intervalMs.raw)).toBe(true);
    const preview = await tool('pixprite_preview');
    expect(preview.mimeType).toBe('image/png');
    expect(Buffer.from(preview.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    const path = join(directory, 'roundtrip.pixprite');
    await tool('pixprite_save', { path });
    expect(JSON.parse(await readFile(path, 'utf8')).width).toBe(10);
    await tool('pixprite_open', { path });
    expect((await tool('pixprite_documents')).documents).toHaveLength(2);
    const png = join(directory, 'frame.png');
    await tool('pixprite_save', { path: png });
    expect((await readFile(png)).subarray(1, 4).toString()).toBe('PNG');
    await tool('pixprite_open', { path: png });
    expect((await tool('pixprite_inspect')).width).toBe(10);
  } finally {
    client.stdin.end(); client.kill(); lines.close();
    await f.dispose();
  }
});
