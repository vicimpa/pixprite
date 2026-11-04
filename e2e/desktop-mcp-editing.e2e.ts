import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './desktop-helper';

test('native pixel aspect ratio preserves aseprite metadata and supports raw or baked PNG saves', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    const doc = await f.call('create', { width: 4, height: 3, name: 'Rectangular pixels' });
    await f.call('command', { documentId: doc.id, id: 'image.pixelRatio', args: { x: 2, y: 1 } });
    await f.call('pixels', { documentId: doc.id, action: 'fill', fill: '#10e050' });
    const path = join(f.directory, 'ratio.aseprite');
    await f.call('save_file', { documentId: doc.id, path });
    const bytes = await readFile(path);
    expect([bytes[34], bytes[35]]).toEqual([2, 1]);
    const opened = await f.call('open_file', { path });
    expect(opened).toMatchObject({ width: 4, height: 3, pixelRatioX: 2, pixelRatioY: 1, importWarnings: [] });
    for (const applyPixelRatio of [false, true]) {
      const png = join(f.directory, `ratio-${applyPixelRatio}.png`);
      await f.call('save_file', { documentId: opened.id, path: png, applyPixelRatio });
      const encoded = await readFile(png);
      expect([encoded.readUInt32BE(16), encoded.readUInt32BE(20)]).toEqual([applyPixelRatio ? 8 : 4, 3]);
    }
  } finally { await f.dispose(); }
});

test('lossy .aseprite imports protect existing files even with overwrite:true and preserve diagnostics in working copies', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    const doc = await f.call('create', { width: 8, height: 8 });
    const path = join(f.directory, 'source.aseprite');
    await f.call('save_file', { documentId: doc.id, path });
    const bytes = Buffer.concat([await readFile(path), Buffer.from([6, 0, 0, 0, 0xef, 0xbe])]);
    bytes.writeUInt32LE(bytes.length, 0); bytes.writeUInt32LE(bytes.length - 128, 128);
    bytes.writeUInt32LE(bytes.readUInt32LE(140) + 1, 140);
    await writeFile(path, bytes);
    const opened = await f.call('open_file', { path });
    expect(opened.importWarnings).toEqual([{ kind: 'unknownChunk', detail: '0xbeef' }]);
    await expect(f.call('save_file', { documentId: opened.id, path, overwrite: true })).rejects.toThrow('protected');
    expect(await readFile(path)).toEqual(bytes);
    const copy = await f.call('save_file', { documentId: opened.id, path: join(f.directory, 'copy.aseprite') });
    expect(copy.warnings).toEqual(opened.importWarnings);
    const project = join(f.directory, 'working.pixprite');
    await f.call('save_file', { documentId: opened.id, path: project });
    const restored = await f.call('open_file', { path: project });
    expect(restored.importWarnings).toEqual(opened.importWarnings);
    await expect(f.call('save_file', { documentId: restored.id, path, overwrite: true })).rejects.toThrow('protected');
    expect(await readFile(path)).toEqual(bytes);
  } finally { await f.dispose(); }
});

test('native MCP playback, addressed atomic pixels and preview provenance', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    const config = JSON.parse(await readFile(f.connection, 'utf8'));
    let serial = 0;
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(config.mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++serial, method, params }) });
      const result = await response.json() as any;
      if (result.error) throw new Error(JSON.stringify(result.error));
      return result.result;
    };
    const tool = (name: string, args: Record<string, unknown>) => rpc('tools/call', { name, arguments: args });
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'editing-regression', version: '1' } });
    const doc = await f.call('create', { width: 8, height: 8, name: 'Playback and edits' });
    await f.call('edit', { operations: [{ method: 'sprite.frames.add', args: [1, { duration: 10000 }] }] });
    expect((await f.call('command', { id: 'anim.play' })).playing).toBe(true);
    expect((await f.call('command', { id: 'anim.play' })).playing).toBe(false);
    await f.call('playback', { action: 'play' });
    const saved = await f.call('save_file', { documentId: doc.id, path: join(f.directory, 'while-playing.pixprite') });
    expect(saved.documentId).toBe(doc.id);
    expect((await f.call('playback', { action: 'pause' })).frame).toBe(1);
    await f.call('playback', { action: 'play' });
    expect(await f.call('playback', { action: 'stop' })).toMatchObject({ frame: 0, playing: false });
    let current = await f.call('inspect');
    const batch = await tool('pixprite_pixels_batch', { documentId: doc.id, expectedRevision: current.revision, operations: [
      { action: 'fill', frame: 0, fill: '#ff0000' }, { action: 'fill', frame: 1, fill: '#00ff00' }, { action: 'read', frame: 1 },
    ] });
    expect(batch.isError).not.toBe(true);
    expect([...Buffer.from(batch.structuredContent.results[2].data, 'base64')].slice(0, 4)).toEqual([0, 255, 0, 255]);
    await f.call('history', { action: 'undo' });
    expect(Buffer.from((await f.call('pixels', { action: 'read', frame: 1 })).data, 'base64').every(v => v === 0)).toBe(true);
    current = await f.call('history', { action: 'redo' });
    const preview = await tool('pixprite_preview', { documentId: doc.id, expectedRevision: current.revision, frame: 1 });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({ documentId: doc.id, revision: current.revision, frame: 1 });
    expect(preview.content[0].type).toBe('image');
    expect(JSON.parse(preview.content[1].text)).toEqual(preview.structuredContent);
    // Decode the immediate preview in the real WebView by importing its PNG, with no delay.
    await f.call('open_data', { name: 'preview.png', data: preview.content[0].data });
    expect([...Buffer.from((await f.call('pixels', { action: 'read' })).data, 'base64')].slice(0, 4)).toEqual([0, 255, 0, 255]);
    const other = await f.call('inspect');
    expect((await tool('pixprite_pixels_batch', { documentId: doc.id, operations: [{ action: 'fill', fill: '#0000ff' }] })).isError).not.toBe(true);
    expect((await f.call('save_file', { documentId: doc.id, path: join(f.directory, 'addressed-document.png') })).documentId).toBe(doc.id);
    expect((await f.call('inspect', { documentId: other.id })).revision).toBe(other.revision);
    await f.call('select', { id: doc.id });
    expect((await tool('pixprite_pixels_batch', { documentId: doc.id, expectedRevision: doc.revision, operations: [{ action: 'fill', fill: '#0000ff' }] })).isError).toBe(true);
  } finally { await f.dispose(); }
});
