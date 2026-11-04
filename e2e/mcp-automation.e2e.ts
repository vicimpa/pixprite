import { expect, test, type Page } from '@playwright/test';

async function request(page: Page, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(({ method, params }) => (window as any).__mcpRequest({ method, params }), { method, params });
}

async function uiCommand(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
}

async function exportScale(page: Page, scale: number) {
  await uiCommand(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.locator('px-select').first().getByRole('button').click();
  await page.getByRole('option', { name: 'PNG, current frame', exact: true }).click();
  await dialog.getByRole('spinbutton').first().fill(String(scale));
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
}

async function savedExportScales(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      const tx = db.transaction('sessions'), store = tx.objectStore('sessions');
      const get = <T,>(r: IDBRequest<T>) => new Promise<T>(resolve => { r.onsuccess = () => resolve(r.result); });
      const [keys, values] = await Promise.all([get(store.getAllKeys()), get(store.getAll())]);
      return values.flatMap((value, i) => String(keys[i]).startsWith('editor:') && value?.lastExport ? [value.lastExport.options.scale as number] : []).sort();
    } finally { db.close(); }
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' }));
    (window as any).pixpriteDesktop = {
      runtime: 'tauri', platform: 'darwin', windowId: 'main', recoveryWindows: [],
      readSessions: async () => ({}), reportSession: async () => {}, recoveredWindows() {},
      windowState: async () => ({ focused: true, maximized: false, fullscreen: false }), onWindowState: () => () => {}, controlWindow: async () => {},
      ready() {}, onRequest(handler: unknown) { (window as any).__mcpRequest = handler; }, onFiles() {}, setLanguage() {},
      getUpdate: async () => ({ currentVersion: '0.0.6' }), onUpdate: () => () => {}, update: async () => {},
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
});

test('MCP atomically edits 6 layers / 60 frames, rejects tab and revision changes, and coalesces undo', async ({ page }) => {
  const doc = await request(page, 'create', { width: 8, height: 8, name: 'Batch' });
  const operations = [
    ...Array.from({ length: 5 }, (_, i) => ({ method: 'sprite.layers.add', args: [{ name: `Layer ${i + 2}` }] })),
    ...Array.from({ length: 59 }, (_, i) => ({ method: 'sprite.frames.add', args: [i + 1] })),
  ];
  await request(page, 'edit', { documentId: doc.id, expectedRevision: doc.revision, operations });
  let current = await request(page, 'history', { action: 'undo' });
  expect(current.layers).toHaveLength(1); expect(current.frames).toHaveLength(1);
  current = await request(page, 'history', { action: 'redo' });
  expect(current.layers).toHaveLength(6); expect(current.frames).toHaveLength(60);
  const pixelOps = Array.from({ length: 360 }, (_, i) => ({ action: 'fill', layer: i % 6, frame: Math.floor(i / 6),
    rect: { x: i % 6, y: 0, w: 1, h: 1 }, fill: '#ff008080' }));
  const result = await request(page, 'pixels_batch', { documentId: doc.id, expectedRevision: current.revision, operations: [
    ...pixelOps, { action: 'read', layer: 5, frame: 59, rect: { x: 5, y: 0, w: 1, h: 1 } },
  ] });
  expect(result.results).toHaveLength(361);
  expect([...Buffer.from(result.results[360].data, 'base64')]).toEqual([255, 0, 128, 128]);
  await request(page, 'history', { action: 'undo' });
  const empty = await request(page, 'pixels', { action: 'read', layer: 0, frame: 0 });
  expect(Buffer.from(empty.data, 'base64').every(v => v === 0)).toBe(true);
  current = await request(page, 'history', { action: 'redo' });
  await expect(request(page, 'pixels_batch', { documentId: doc.id, expectedRevision: result.revision, operations: pixelOps })).rejects.toThrow('revision mismatch');
  await expect(request(page, 'pixels_batch', { operations: [pixelOps[0], { ...pixelOps[1], data: 'bad' }] })).rejects.toThrow('exactly one');
  expect((await request(page, 'inspect')).revision).toBe(current.revision);
  // A runtime failure after a valid structural change must restore the whole batch.
  await expect(request(page, 'edit', { operations: [{ method: 'sprite.layers.add', args: [{ name: 'rollback' }] }, { method: 'sprite.frames.remove', args: [999] }] })).rejects.toThrow();
  expect((await request(page, 'inspect')).layers).toHaveLength(6);
  const other = await request(page, 'create', { width: 8, height: 8, name: 'User switched tabs' });
  const background = await request(page, 'inspect', { documentId: doc.id });
  await request(page, 'pixels_batch', { documentId: doc.id, expectedRevision: background.revision, operations: pixelOps });
  expect((await request(page, 'inspect', { documentId: other.id })).revision).toBe(other.revision);
  await request(page, 'select', { id: doc.id });
  const view = await request(page, 'view', { documentId: doc.id, frame: 59, layer: 5, zoom: 8, pan: { x: 3, y: 4 }, onion: { enabled: true, before: 2, after: 1, opacity: 0.3 } });
  expect(view).toMatchObject({ frame: 59, layer: 5, view: { zoom: 8, pan: { x: 3, y: 4 }, onion: { enabled: true, before: 2, after: 1, opacity: 0.3 } } });
});

test('MCP playback can stop with the legacy toggle and explicit controls while playing', async ({ page }) => {
  await request(page, 'create', { width: 8, height: 8 });
  await request(page, 'edit', { operations: [{ method: 'sprite.frames.add', args: [1, { duration: 10000 }] }] });
  expect(await request(page, 'command', { id: 'anim.play' })).toMatchObject({ playing: true });
  expect(await request(page, 'command', { id: 'anim.play' })).toMatchObject({ playing: false });
  expect(await request(page, 'playback', { action: 'play' })).toMatchObject({ playing: true });
  expect(await request(page, 'inspect')).toMatchObject({ playing: true });
  expect(await request(page, 'playback', { action: 'pause' })).toMatchObject({ playing: false, frame: 1 });
  await request(page, 'playback', { action: 'play' });
  expect(await request(page, 'playback', { action: 'stop' })).toMatchObject({ playing: false, frame: 0 });
  const other = await request(page, 'create', { width: 8, height: 8 });
  await request(page, 'select', { id: (await request(page, 'documents')).documents[0].id });
  await request(page, 'playback', { action: 'play' });
  expect(await request(page, 'select', { id: other.id })).toMatchObject({ id: other.id, playing: false });
});

test('MCP previews immediately reflect writes and comparisons remain visible without editing references', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Reference' });
  for (const fill of ['#ff0000', '#00ff00', '#0000ff', '#ffff00']) {
    const edit = await request(page, 'pixels', { action: 'write', fill });
    const preview = await request(page, 'preview', { documentId: source.id, expectedRevision: edit.revision });
    expect(preview).toMatchObject({ documentId: source.id, frame: 0, revision: edit.revision });
    const rgba = await page.evaluate(async data => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0); return [...ctx.getImageData(0, 0, 1, 1).data];
    }, preview.image);
    expect(rgba).toEqual([...Buffer.from(fill.slice(1), 'hex'), 255]);
  }
  const referenceRevision = (await request(page, 'inspect')).revision;
  const target = await request(page, 'create', { width: 8, height: 8, name: 'Character' });
  await page.getByTestId('document-tabs').getByText('Character', { exact: true }).click();
  const sheet = await request(page, 'compare', { items: [{ documentId: source.id, frame: 0 }, { documentId: target.id, frame: 0, reference: { documentId: source.id, frame: 0 } }], columns: 2, scale: 8, guides: [{ axis: 'y', pos: 3 }] });
  expect(sheet).toMatchObject({ width: 128, height: 64 });
  expect(sheet.items[0]).toMatchObject({ documentId: source.id, revision: referenceRevision });
  const guide = await page.evaluate(async data => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0); return [...ctx.getImageData(0, 24, 1, 1).data];
  }, sheet.image);
  expect(guide).toEqual([0, 217, 255, 255]);
  await expect(page.getByTestId('comparison-viewer')).toHaveCount(0);
  await page.locator(`[data-viewer="${sheet.viewerId}"]`).click();
  await expect(page.getByTestId('comparison-viewer')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('comparison.png') });
  const docs = await request(page, 'documents');
  expect(docs.documents).toHaveLength(2); expect(docs.target).toBe(target.id);
  expect(docs.documents.find((d: any) => d.id === source.id).revision).toBe(referenceRevision);
  const before = docs.documents.map((doc: any) => doc.revision);
  await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  expect((await request(page, 'documents')).documents.map((doc: any) => doc.revision)).toEqual(before);
  await page.getByTestId('comparison-viewer').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('comparison-viewer')).toHaveCount(0);
  expect((await request(page, 'documents')).active).toBe(target.id);
});

test('MCP native selection clipboard pastes across documents and transforms in one undo step', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Source fragment' });
  await request(page, 'pixels', { action: 'write', rect: { x: 0, y: 0, w: 2, h: 1 }, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]).toString('base64') });
  await request(page, 'edit', { operations: [{ method: 'sprite.selection.set', args: [{ x: 0, y: 0, w: 2, h: 1 }] }] });
  await request(page, 'selection', { action: 'copy' });
  const revision = (await request(page, 'inspect')).revision;
  const target = await request(page, 'create', { width: 8, height: 8, name: 'Destination' });
  await request(page, 'selection', { action: 'paste', x: 2, y: 2, flipX: true });
  let pixels = await request(page, 'pixels', { action: 'read', rect: { x: 2, y: 2, w: 2, h: 1 } });
  expect([...Buffer.from(pixels.data, 'base64')]).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  await request(page, 'history', { action: 'undo' });
  pixels = await request(page, 'pixels', { action: 'read' });
  expect(Buffer.from(pixels.data, 'base64').every(v => v === 0)).toBe(true);
  await request(page, 'history', { action: 'redo' });
  await request(page, 'selection', { action: 'transform', turns: 1, x: 2, y: 2 });
  pixels = await request(page, 'pixels', { action: 'read', rect: { x: 2, y: 2, w: 1, h: 2 } });
  expect([...Buffer.from(pixels.data, 'base64')], JSON.stringify(await request(page, 'inspect'))).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  const docs = await request(page, 'documents');
  expect(docs.target).toBe(target.id);
  expect(docs.documents.find((d: any) => d.id === source.id).revision).toBe(revision);
});

test('user tabs, frame cursor and camera are independent of background agent edits; closed IDs never redirect', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Agent project' });
  await request(page, 'edit', { operations: [{ method: 'sprite.layers.add', args: [{ name: 'Agent layer' }] }, { method: 'sprite.frames.add', args: [1] }] });
  const other = await request(page, 'create', { width: 8, height: 8, name: 'User project' });
  await page.getByTestId('document-tabs').getByText('User project', { exact: true }).click();
  await request(page, 'view', { documentId: source.id, contextId: 'worker', frame: 1, layer: 1, zoom: 16 });
  await request(page, 'pixels', { documentId: source.id, contextId: 'worker', action: 'fill', fill: '#ff0000', rect: { x: 1, y: 1, w: 1, h: 1 } });
  await expect(page.getByTestId('document-tabs').locator('[data-active=true]')).toContainText('User project');
  expect((await request(page, 'documents')).active).toBe(other.id);
  const sourcePixels = await request(page, 'pixels', { documentId: source.id, action: 'read', layer: 1, frame: 1, encoding: 'hex', rect: { x: 1, y: 1, w: 1, h: 1 } });
  expect(sourcePixels.rows).toEqual([['#ff0000']]);
  expect((await request(page, 'inspect', { documentId: source.id, contextId: 'other-worker' })).frame).toBe(0);
  const userPixels = await request(page, 'pixels', { documentId: other.id, action: 'read' });
  expect(Buffer.from(userPixels.data, 'base64').every(v => v === 0)).toBe(true);
  // Normal UI closes the intended target. The worker must not fall back to a visible tab.
  await page.getByTestId('document-tabs').getByText('Agent project', { exact: true }).click();
  await page.getByTestId('document-tabs').locator('[data-active=true]').getByTitle('Close (middle click)').click().catch(async () => {
    await page.getByTestId('document-tabs').locator('[data-active=true] button').click();
  });
  const discard = page.getByRole('button', { name: /^(Discard|Don.t save)$/i });
  if (await discard.isVisible()) await discard.click();
  await expect(request(page, 'pixels', { documentId: source.id, contextId: 'worker', action: 'fill', fill: '#00ff00' })).rejects.toThrow('not open');
});

test('idle follow stays inside the focused editor and yields immediately to user input', async ({ page }) => {
  await page.clock.install();
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Follow agent' });
  await request(page, 'create', { width: 8, height: 8, name: 'Keep my view' });
  await page.getByTestId('document-tabs').getByText('Keep my view', { exact: true }).click();
  await request(page, 'view', { documentId: source.id, frame: 0, layer: 0, zoom: 8 });
  await page.clock.fastForward(9_000);
  await expect(page.getByTestId('document-tabs').locator('[data-active=true]')).toContainText('Keep my view');
  await page.clock.fastForward(1_100);
  await expect(page.getByTestId('document-tabs').locator('[data-active=true]')).toContainText('Follow agent');
  await expect(page.getByTestId('agent-activity')).toHaveAttribute('data-following', 'true');
  await page.getByTestId('document-tabs').getByText('Keep my view', { exact: true }).click();
  await expect(page.getByTestId('agent-activity')).toHaveAttribute('data-following', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await request(page, 'view', { documentId: source.id, zoom: 16 });
  await page.clock.fastForward(20_000);
  await expect(page.getByTestId('document-tabs').locator('[data-active=true]')).toContainText('Keep my view');
});

test('manual changes conflict with a stale agent read while analysis reports exact anchors and colors', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Conflicts' });
  await page.getByTestId('document-tabs').getByText('Conflicts', { exact: true }).click();
  await request(page, 'inspect', { documentId: source.id });
  const box = (await page.getByTestId('sprite-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(request(page, 'pixels', { action: 'fill', fill: '#ff0000' })).rejects.toThrow('revision mismatch');
  const latest = await request(page, 'inspect');
  await request(page, 'pixels', { expectedRevision: latest.revision, action: 'fill', rect: { x: 2, y: 3, w: 2, h: 1 }, fill: '#ff0000' });
  const measured = await request(page, 'analyze', { layers: [0], frames: [0] });
  expect(measured.cels[0].pixels).toBeGreaterThanOrEqual(2);
  expect(measured.cels[0].colors).toContainEqual({ color: '#ff0000ff', count: 2 });
});

test('background palettes and undo never use the palette of the visible document', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Indexed agent', colorMode: 'indexed' });
  const other = await request(page, 'create', { width: 8, height: 8, name: 'Visible palette' });
  await page.getByTestId('document-tabs').getByText('Visible palette', { exact: true }).click();
  const original = await request(page, 'inspect', { documentId: other.id, contextId: 'user-observer' });
  await request(page, 'edit', { documentId: source.id, operations: [{ method: 'sprite.palette.set', args: [['#ff0000', '#00ff00'], { keepPixels: true }] }] });
  expect((await request(page, 'inspect', { documentId: source.id })).palette).toEqual(['#ff0000', '#00ff00']);
  await request(page, 'pixels', { documentId: source.id, action: 'fill', fill: '#00ff00', rect: { x: 2, y: 3, w: 1, h: 1 } });
  const pixel = await request(page, 'pixels', { documentId: source.id, action: 'read', encoding: 'hex', rect: { x: 2, y: 3, w: 1, h: 1 } });
  expect(pixel.rows).toEqual([['#00ff00']]);
  await request(page, 'history', { documentId: source.id, action: 'undo' });
  await request(page, 'history', { documentId: source.id, action: 'undo' });
  expect((await request(page, 'inspect', { documentId: other.id, contextId: 'user-observer' })).palette).toEqual(original.palette);
  await expect(page.getByTestId('document-tabs').locator('[data-active=true]')).toContainText('Visible palette');
});

test('agent uses each indexed frame palette while the user keeps a different phase selected', async ({ page }) => {
  const raw = { format: 'pixprite', version: 4, name: 'Per-frame palettes', width: 8, height: 8, colorMode: 'indexed', transparentIndex: -1,
    palette: ['#ff0000'], frames: [{ duration: 100 }, { duration: 100 }],
    layers: [{ name: 'Layer 1', visible: true, locked: false, background: false, continuous: false, opacity: 1, blend: 'source-over', group: false, depth: 0, collapsed: false, tileset: -1, clip: false, cels: [null, null], celOpacity: [1, 1] }],
    tags: [], slices: [], guides: [], tilesets: [], framePalettes: [{ frame: 0, colors: ['#ff0000'] }, { frame: 1, colors: ['#00ff00'] }] };
  const source = await request(page, 'open_data', { name: 'palettes.pixprite', data: Buffer.from(JSON.stringify(raw)).toString('base64') });
  await page.getByTestId('document-tabs').getByText(source.name, { exact: true }).click();
  await page.locator('[data-hit=frame][data-f="1"]').click();
  await expect(page.locator('[data-hit=frame][data-f="1"]')).toHaveAttribute('data-current', 'true');
  await request(page, 'pixels_batch', { documentId: source.id, operations: [
    { action: 'fill', layer: 0, frame: 0, fill: '#ff0000', rect: { x: 1, y: 1, w: 1, h: 1 } },
    { action: 'fill', layer: 0, frame: 1, fill: '#00ff00', rect: { x: 1, y: 1, w: 1, h: 1 } },
  ] });
  for (const [frame, color] of [[0, '#ff0000'], [1, '#00ff00']] as const) {
    const pixels = await request(page, 'pixels', { action: 'read', frame, layer: 0, encoding: 'hex', rect: { x: 1, y: 1, w: 1, h: 1 } });
    expect(pixels.rows).toEqual([[color]]);
  }
  await request(page, 'view', { frame: 0 });
  await request(page, 'edit', { operations: [{ method: 'sprite.palette.set', args: [['#0000ff']] }] });
  const pixels = await request(page, 'pixels', { action: 'read', frame: 0, layer: 0, encoding: 'hex', rect: { x: 1, y: 1, w: 1, h: 1 } });
  expect(pixels.rows).toEqual([['#0000ff']]);
  await expect(page.locator('[data-hit=frame][data-f="1"]')).toHaveAttribute('data-current', 'true');
  await expect(page.locator('[data-i="0"]').first()).toHaveCSS('background-color', 'rgb(0, 255, 0)');
});

test('successful export settings stay with each document across reload; cancellation and failure keep the previous settings', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__exports = [];
    (window as any).pixpriteDesktop.saveDownload = async (name: string, blob: Blob) => {
      if ((window as any).__exportMode === 'cancel') return false;
      if ((window as any).__exportMode === 'fail') throw new Error('Simulated export write error');
      const image = await createImageBitmap(blob);
      (window as any).__exports.push({ name, width: image.width }); image.close(); return true;
    };
  });
  await request(page, 'create', { width: 8, height: 8, name: 'Export A' });
  await page.getByTestId('document-tabs').getByText('Export A', { exact: true }).click();
  await uiCommand(page, 'file.save');
  const projectId = async () => (await request(page, 'documents')).documents.find((doc: any) => doc.name === 'Export A')?.project;
  await expect.poll(projectId).toMatch(/^(?!session:).+/);
  const project = await projectId();
  await exportScale(page, 2);
  await expect.poll(() => savedExportScales(page)).toEqual([2]);
  await request(page, 'create', { width: 8, height: 8, name: 'Export B' });
  await page.getByTestId('document-tabs').getByText('Export B', { exact: true }).click();
  await exportScale(page, 3);
  await expect.poll(() => savedExportScales(page)).toEqual([2, 3]);
  for (const mode of ['cancel', 'fail']) {
    await page.evaluate(mode => { (window as any).__exportMode = mode; }, mode);
    await exportScale(page, 5);
    if (mode === 'fail') await expect(page.getByText(/Simulated export write error/)).toBeVisible();
    await uiCommand(page, 'file.export');
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await expect(dialog.getByRole('spinbutton').first()).toHaveValue('3');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await page.evaluate(() => { (window as any).__exportMode = 'ok'; });
  await page.getByTestId('document-tabs').getByText('Export A', { exact: true }).click();
  await uiCommand(page, 'file.repeatExport');
  await expect.poll(() => page.evaluate(() => (window as any).__exports.at(-1))).toEqual({ name: 'Export A.png', width: 16 });
  await expect.poll(() => savedExportScales(page)).toEqual([2, 3]);
  await page.reload();
  await expect(page.getByTestId('document-tabs').getByText('Export A', { exact: true })).toBeVisible();
  await page.getByTestId('document-tabs').getByText('Export A', { exact: true }).click();
  await uiCommand(page, 'file.export');
  const restored = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(restored.getByRole('spinbutton').first()).toHaveValue('2');
  await restored.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('document-tabs').locator('[data-active=true]').getByTitle('Close (middle click)').click();
  await request(page, 'open_project', { id: project });
  await page.getByTestId('document-tabs').getByText('Export A', { exact: true }).click();
  await uiCommand(page, 'file.export');
  await expect(page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('spinbutton').first()).toHaveValue('2');
});

test('finishing an export after a tab switch updates only the source document', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).pixpriteDesktop.saveDownload = () => new Promise<boolean>(resolve => { (window as any).__finishExport = resolve; });
  });
  await request(page, 'create', { width: 8, height: 8, name: 'Pending export' });
  await page.getByTestId('document-tabs').getByText('Pending export', { exact: true }).click();
  await exportScale(page, 4);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishExport)).toBe('function');
  await request(page, 'create', { width: 8, height: 8, name: 'Keep my export' });
  await page.getByTestId('document-tabs').getByText('Keep my export', { exact: true }).click();
  await page.evaluate(() => (window as any).__finishExport(true));
  await expect.poll(() => savedExportScales(page)).toEqual([4]);
  await uiCommand(page, 'file.repeatExport');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog.getByRole('spinbutton').first()).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('document-tabs').getByText('Pending export', { exact: true }).click();
  await uiCommand(page, 'file.export');
  await expect(page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('spinbutton').first()).toHaveValue('4');
});

test('lossy .aseprite imports keep diagnostics through .pixprite saves and require an explicit protected copy', async ({ page }) => {
  await request(page, 'create', { width: 8, height: 8 });
  const output = await request(page, 'export_data', { format: 'aseprite' });
  const source = Buffer.concat([Buffer.from(output.data, 'base64'), Buffer.from([6, 0, 0, 0, 0xef, 0xbe])]);
  source.writeUInt32LE(source.length, 0); source.writeUInt32LE(source.length - 128, 128);
  source.writeUInt32LE(source.readUInt32LE(140) + 1, 140);
  const opened = await request(page, 'open_data', { name: 'unsupported.aseprite', data: source.toString('base64') });
  expect(opened.importWarnings).toEqual([{ kind: 'unknownChunk', detail: '0xbeef' }]);
  const saved = await request(page, 'export_data', { format: 'pixprite' });
  const reopened = await request(page, 'open_data', { name: 'working-copy.pixprite', data: saved.data });
  expect(reopened.importWarnings).toEqual(opened.importWarnings);
  await page.getByTestId('document-tabs').getByText('unsupported', { exact: true }).first().click();
  await page.evaluate(() => {
    (window as any).__copies = [];
    (window as any).pixpriteDesktop.saveDownload = async (name: string, _blob: Blob, protect: boolean) => {
      (window as any).__copies.push({ name, protect }); return true;
    };
  });
  await uiCommand(page, 'file.download');
  const dialog = page.getByRole('dialog', { name: 'Download a copy', exact: true });
  await dialog.locator('px-select').getByRole('button').click();
  await page.getByRole('option', { name: /Aseprite file/ }).click();
  await expect(dialog).toContainText('Unsupported data chunk (0xbeef)');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Save an Aseprite copy', exact: true });
  await expect(warning).toBeVisible();
  expect(await page.evaluate(() => (window as any).__copies)).toEqual([]);
  await warning.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copies)).toEqual([{ name: 'unsupported-copy.aseprite', protect: true }]);
});

test('background file.save persists the addressed document without changing user tabs, pixels or undo', async ({ page }) => {
  const source = await request(page, 'create', { width: 8, height: 8, name: 'Save target' });
  const edit = await request(page, 'pixels', { documentId: source.id, action: 'fill', fill: '#ff0000' });
  const other = await request(page, 'create', { width: 8, height: 8, name: 'Keep unsaved' });
  await page.getByTestId('document-tabs').getByText('Keep unsaved', { exact: true }).click();
  expect(await request(page, 'commands', { filter: 'file.save' })).toMatchObject([{ id: 'file.save' }]);
  const saved = await request(page, 'command', { documentId: source.id, expectedRevision: edit.revision, id: 'file.save' });
  expect(saved.revision).toBe(edit.revision);
  expect((await request(page, 'documents')).active).toBe(other.id);
  expect((await request(page, 'library')).projects.map((p: any) => p.name)).toEqual(['Save target']);
  await request(page, 'history', { documentId: source.id, action: 'undo' });
  const pixels = await request(page, 'pixels', { documentId: source.id, action: 'read' });
  expect(Buffer.from(pixels.data, 'base64').every(v => v === 0)).toBe(true);
});

for (const ratio of [[2, 1], [1, 2], [4, 5], [8, 7]]) test(`non-square pixels ${ratio.join(':')} change display geometry while painting and undo keep logical coordinates`, async ({ page }) => {
  const doc = await request(page, 'create', { width: 4, height: 3, name: 'Wide pixels' });
  await request(page, 'pixels', { action: 'fill', fill: '#10e050' });
  await page.getByTestId('document-tabs').getByText('Wide pixels', { exact: true }).click();
  await uiCommand(page, 'image.properties');
  const properties = page.getByRole('dialog', { name: 'Image properties', exact: true });
  await properties.getByRole('button', { name: '1:1', exact: true }).click();
  await page.getByRole('option', { name: ratio.join(':'), exact: true }).click();
  await properties.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await request(page, 'inspect')).toMatchObject({ width: 4, height: 3, pixelRatioX: ratio[0], pixelRatioY: ratio[1] });
  const canvas = page.getByTestId('sprite-canvas').locator('canvas');
  const bounds = (target = canvas) => target.evaluate((can: HTMLCanvasElement) => {
    const pixels = can.getContext('2d')!.getImageData(0, 0, can.width, can.height).data;
    let x0 = can.width, y0 = can.height, x1 = -1, y1 = -1;
    for (let y = 0; y < can.height; y++) for (let x = 0; x < can.width; x++) {
      const i = (y * can.width + x) * 4;
      if (pixels[i] === 16 && pixels[i + 1] === 224 && pixels[i + 2] === 80) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, scale: can.width / can.getBoundingClientRect().width };
  });
  await expect.poll(async () => { const b = await bounds(); return b.w > 0 && b.h > 0 ? b.w / b.h * 3 / 4 : 0; }).toBeCloseTo(ratio[0] / ratio[1], 1);
  await uiCommand(page, 'view.preview');
  const previewCanvas = page.getByTestId('sprite-preview').locator('canvas');
  await expect.poll(async () => { const b = await bounds(previewCanvas); return b.w > 0 && b.h > 0 ? b.w / b.h * 3 / 4 : 0; }).toBeCloseTo(ratio[0] / ratio[1], 1);
  if (ratio[0] === 2) await page.screenshot({ path: test.info().outputPath('wide-pixels-and-preview.png') });
  await uiCommand(page, 'view.preview');
  const b = await bounds(), box = (await canvas.boundingBox())!;
  await page.keyboard.press('b');
  await page.mouse.click(box.x + (b.x + b.w / 4 * 1.5) / b.scale, box.y + (b.y + b.h / 3 * 1.5) / b.scale);
  const pixels = await request(page, 'pixels', { documentId: doc.id, action: 'read', encoding: 'hex' });
  expect(pixels.rows[1][1]).not.toBe('#10e050');
  expect(pixels.rows.flat().filter((c: string) => c !== '#10e050')).toHaveLength(1);
  // WebKit can acknowledge mouse.up before its pointerup handler commits the stroke.
  // Retry only the explicit pre-write refusal; a successful undo runs once.
  await expect.poll(async () => {
    try { await request(page, 'history', { action: 'undo' }); return true; }
    catch (error) {
      if (String(error).includes('unfinished user edit')) return false;
      throw error;
    }
  }).toBe(true);
  expect((await request(page, 'pixels', { action: 'read', encoding: 'hex' })).rows.flat().every((c: string) => c === '#10e050')).toBe(true);
  await request(page, 'history', { action: 'undo' });
  expect(await request(page, 'inspect')).toMatchObject({ pixelRatioX: 1, pixelRatioY: 1 });
});

test('pixel aspect ratio survives native-format round trips and raster exports optionally bake it', async ({ page }) => {
  const doc = await request(page, 'create', { width: 4, height: 3, name: 'Tall pixels' });
  await request(page, 'command', { id: 'image.pixelRatio', args: { x: 1, y: 2 } });
  await request(page, 'pixels', { action: 'fill', fill: '#10e050' });
  const preview = await request(page, 'preview');
  const dimensions = (data: string) => page.evaluate(async data => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const result = { width: image.width, height: image.height }; image.close(); return result;
  }, data);
  expect(await dimensions(preview.image)).toEqual({ width: 4, height: 6 });
  expect(preview).toMatchObject({ logicalWidth: 4, logicalHeight: 3, pixelRatioX: 1, pixelRatioY: 2 });
  const sheet = await request(page, 'compare', { items: [{ documentId: doc.id, frame: 0 }], scale: 1, show: false });
  expect(sheet).toMatchObject({ width: 4, height: 6 });
  for (const format of ['pixprite', 'aseprite']) {
    const saved = await request(page, 'export_data', { documentId: doc.id, format });
    const opened = await request(page, 'open_data', { name: `round-trip.${format}`, data: saved.data });
    expect(opened).toMatchObject({ width: 4, height: 3, pixelRatioX: 1, pixelRatioY: 2, importWarnings: [] });
  }
  await page.getByTestId('document-tabs').getByText('Tall pixels', { exact: true }).first().click();
  await page.evaluate(() => {
    (window as any).__aspectExports = [];
    (window as any).pixpriteDesktop.saveDownload = async (_name: string, blob: Blob) => {
      const image = await createImageBitmap(blob);
      (window as any).__aspectExports.push({ width: image.width, height: image.height }); image.close(); return true;
    };
  });
  await exportScale(page, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__aspectExports)).toEqual([{ width: 4, height: 3 }]);
  await uiCommand(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('checkbox', { name: 'Apply pixel aspect ratio to output', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__aspectExports)).toEqual([{ width: 4, height: 3 }, { width: 4, height: 6 }]);
});

test('a new document accepts a pixel ratio and sprite-sheet JSON matches its baked PNG', async ({ page }) => {
  await uiCommand(page, 'file.new');
  const create = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await create.getByRole('textbox').first().fill('Ratio sheet');
  await create.getByRole('spinbutton').nth(0).fill('4'); await create.getByRole('spinbutton').nth(1).fill('3');
  await create.getByRole('button', { name: '1:1', exact: true }).click();
  await page.getByRole('option', { name: '2:1', exact: true }).click();
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  const id = (await request(page, 'documents')).active;
  expect(await request(page, 'inspect', { documentId: id })).toMatchObject({ width: 4, height: 3, pixelRatioX: 2, pixelRatioY: 1 });
  await request(page, 'pixels', { documentId: id, action: 'fill', fill: '#10e050' });
  await page.evaluate(() => {
    (window as any).__sheetFiles = [];
    (window as any).pixpriteDesktop.saveDownload = async (name: string, blob: Blob) => {
      if (name.endsWith('.json')) (window as any).__sheetFiles.push({ name, json: JSON.parse(await blob.text()) });
      else { const image = await createImageBitmap(blob); (window as any).__sheetFiles.push({ name, width: image.width, height: image.height }); image.close(); }
      return true;
    };
  });
  await uiCommand(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.locator('px-select').first().getByRole('button').click();
  await page.getByRole('option', { name: 'PNG sprite sheet', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Apply pixel aspect ratio to output', exact: true }).check();
  await dialog.getByText('Data file', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('option', { name: 'JSON (frames by name)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__sheetFiles.length)).toBe(2);
  const files = await page.evaluate(() => (window as any).__sheetFiles);
  expect(files[0]).toMatchObject({ width: 8, height: 3 });
  expect(files[1].json.meta.size).toEqual({ w: 8, h: 3 });
  expect(Object.values(files[1].json.frames)[0]).toMatchObject({ frame: { x: 0, y: 0, w: 8, h: 3 }, sourceSize: { w: 8, h: 3 } });
});
