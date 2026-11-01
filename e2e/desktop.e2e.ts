import { expect, test } from '@playwright/test';
import { nativeFixture } from './desktop-helper';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { callDesktop } from '../desktop/connection';

test('native editor is controlled end to end through its embedded HTTP MCP server', async () => {
  test.setTimeout(90_000);
  const f = await nativeFixture();
  const { directory, connection } = f;
  const gui = await f.launch();
  const config = JSON.parse(await readFile(connection, 'utf8'));
  expect(config.pid).toBe(gui.pid);
  let serial = 0;
  async function rpc(method: string, params: unknown) {
    const response = await fetch(config.mcpUrl, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++serial, method, params }),
    });
    const reply = await response.json() as any;
    if (reply.error) throw new Error(JSON.stringify(reply.error));
    return reply.result;
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
    await fetch(config.mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect((await rpc('tools/list', {})).tools.map((tool: { name: string }) => tool.name)).toContain('pixprite_pixels');
    expect((await rpc('tools/list', {})).tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(['pixprite_library', 'pixprite_open_project']));
    expect(await tool('pixprite_library')).toEqual({ folders: [], projects: [] });
    expect((await rpc('tools/call', { name: 'pixprite_open_project', arguments: { id: 'missing-project' } })).isError).toBe(true);
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
    await f.dispose();
  }
});
