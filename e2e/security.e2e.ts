import { expect, test, type Page } from '@playwright/test';

const api = (page: Page, method: string, ...args: unknown[]) => page.evaluate(([method, args]) => (window as any).security[method](...args), [method, args] as const);
const extension = (body: string) => `import { defineExtension } from '@pixprite/api'; export default defineExtension(async ctx => { ${body} });`;
const write = `await tx.putPixels(0, 0, {rect:{x:0,y:0,w:1,h:1},format:'rgba',data:new Uint8ClampedArray([11,22,33,255])});`;

// Included by the normal smoke CI command and full production E2E suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', autosave: false })));
  await page.goto('/__security__/e2e/security.html');
  await expect.poll(() => page.evaluate(() => !!(window as any).security)).toBe(true);
  await page.request.get('/__security__/network-log?reset');
});

test('@smoke security: real worker RPC rejects API calls without capabilities', async ({ page }) => {
  await api(page, 'install', extension(`return {async probe() {
    const calls = [() => ctx.sprite.get(), () => ctx.sprite.putPixels(), () => ctx.documents.list(), () => ctx.documents.create({width:1,height:1}),
      () => ctx.storage.get('x'), () => ctx.net.fetch('https://example.test'), () => ctx.ui.panels.show('x'), () => ctx.locks.set({}), () => ctx.commands.run('layer.new')];
    const result = []; for (const call of calls) { try { await call(); result.push('ALLOWED'); } catch(e) { result.push(e.code); } } return result;
  }};`));
  expect((await api(page, 'ready')).status).toBe('running');
  expect(await api(page, 'invoke', 'probe')).toEqual(Array(9).fill('permission'));
  expect((await api(page, 'status')).pixels).toEqual([0, 0, 0, 0]);
});

test('@smoke security: allowlist gates host fetch, credentials, protocols, redirects, and raw worker network', async ({ page }) => {
  const forbidden: string[] = [];
  page.on('request', request => { if (/forbidden|evil\.test/.test(request.url())) forbidden.push(request.url()); });
  await page.context().addCookies([{ name: 'editor-secret', value: 'private', url: 'http://127.0.0.1:4173' }]);
  const requests: Record<string, string>[] = [];
  await page.route('**/__security__/allowed', async route => { requests.push(route.request().headers()); await route.continue(); });
  await api(page, 'install', extension(`return {async probe() {
    const results = {};
    for (const [key,url] of Object.entries({allowed:'http://127.0.0.1:4173/__security__/allowed',other:'http://localhost:4173/__security__/forbidden',suffix:'https://127.0.0.1.evil.test/__security__/forbidden',scheme:'ftp://127.0.0.1:4173/file',redirect:'http://127.0.0.1:4173/__security__/redirect'})) {
      try { results[key] = (await ctx.net.fetch(url)).status; } catch(e) { results[key] = e.code; }
    }
    results.rawFetch = await fetch('http://127.0.0.1:4173/__security__/forbidden').then(()=>true,()=>false);
    results.socket = await new Promise(resolve => { try { const s = new WebSocket('ws://127.0.0.1:4173/__security__/forbidden'); s.onopen=()=>resolve(true); s.onerror=()=>resolve(false); } catch { resolve(false); } });
    return results;
  }};`), ['network:127.0.0.1:4173']);
  await api(page, 'ready');
  expect(await api(page, 'invoke', 'probe')).toEqual({ allowed: 200, other: 'permission', suffix: 'permission', scheme: 'permission', redirect: 'internal', rawFetch: false, socket: false });
  expect(requests).toHaveLength(1);
  expect(requests[0].cookie).toBeUndefined(); expect(requests[0].referer).toBeUndefined();
  expect(await (await page.request.get('/__security__/network-log')).json()).toEqual([]);
  // CSP blocks before a request reaches the server; Playwright may still emit a failed request event.
  expect(forbidden.filter(url => url.includes('evil.test'))).toEqual([]);
});

test('@smoke security: opaque worker has no editor DOM or IndexedDB and cannot bypass RPC via dynamic import', async ({ page }) => {
  await page.evaluate(async () => {
    const r = indexedDB.open('editor-secret'); await new Promise<void>(resolve => r.onsuccess = () => { r.result.close(); resolve(); });
  });
  await api(page, 'install', extension(`return {async probe() {
    let indexed = 'allowed'; try { const r=indexedDB.open('editor-secret'); await new Promise((resolve,reject)=>{r.onsuccess=resolve;r.onerror=reject}); } catch(e) { indexed=e.name; }
    const target = 'http:' + '//127.0.0.1:4173/__security__/forbidden';
    let imported = true; try { await import(target); } catch { imported=false; }
    return {document: typeof document, parent: typeof parent, indexed, imported, origin: self.origin};
  }};`));
  await api(page, 'ready');
  expect(await api(page, 'invoke', 'probe')).toEqual({ document: 'undefined', parent: 'undefined', indexed: 'SecurityError', imported: false, origin: 'null' });
  expect(await page.evaluate(() => document.querySelector('iframe')!.getAttribute('sandbox'))).toBe('allow-scripts');
});

test('@smoke security: opaque panel blocks parent DOM, editor IndexedDB, raw fetch, sockets and image exfiltration', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/__security__/forbidden*', route => { requested.push(route.request().url()); return route.fulfill({ body: 'leak' }); });
  await api(page, 'install', extension('return {};'), ['ui:panel']); await api(page, 'ready');
  await api(page, 'panel', 'panel.html', { 'panel.html': `<script>
    (async () => {
      const results={}; try { results.parent=parent.document.body.innerHTML; } catch(e) { results.parent=e.name; }
      try { indexedDB.open('pixprite'); results.indexed='ALLOWED'; } catch(e) { results.indexed=e.name; }
      results.fetch=await fetch('http://127.0.0.1:4173/__security__/forbidden?fetch').then(()=>true,()=>false);
      results.socket=await new Promise(resolve=>{try{const ws=new WebSocket('ws://127.0.0.1:4173/__security__/forbidden?ws');ws.onopen=()=>resolve(true);ws.onerror=()=>resolve(false)}catch{resolve(false)}});
      results.image=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src='http://127.0.0.1:4173/__security__/forbidden?image'});
      // Raw RPC is still permission checked for a connected iframe.
      addEventListener('message', e=> {if(e.data?.type==='response'&&e.data.id===999){results.rpc=e.data.error.code;document.body.textContent=JSON.stringify(results)}});
      parent.postMessage({type:'request',id:999,method:'sprite.get',params:[]},'*');
    })();
  </script>` });
  await expect(page.frameLocator('#probe-panel').locator('body')).toHaveText(JSON.stringify({ parent: 'SecurityError', indexed: 'SecurityError', fetch: false, socket: false, image: false, rpc: 'permission' }));
  expect(requested).toEqual([]);
});

test('@smoke security: path traversal, malformed manifests and hashes cannot install or read outside a package', async ({ page }) => {
  const escaped: string[] = [];
  await page.route('**/*escape*', route => { escaped.push(route.request().url()); return route.abort(); });
  for (const mode of ['bad-hash', 'bad-manifest-hash', 'missing-manifest-hash', 'malformed-list', 'array-list', 'null-list', 'server-error', 'bad-path', 'encoded-path', 'backslash-path', 'malformed']) {
    const result = await api(page, 'package', { id: 'integrity-probe', path: `http://127.0.0.1:4173/__security__/package/${mode}/` });
    expect(result.error, mode).not.toBeNull(); expect(result.installed, mode).toBe(false); expect(result.running, mode).toBe(false);
  }
  expect((await api(page, 'package', { id: 'integrity-probe', path: 'http://127.0.0.1:4173/__security__/package/valid/', integrity: '0'.repeat(64) })).error).toContain('Integrity');
  await api(page, 'install', extension('return {};')); await api(page, 'ready');
  for (const path of ['../escape.js', '..\\escape.js', '%2e%2e/escape.js', '//evil.test/escape.js', 'x?escape.js']) {
    expect(await api(page, 'badFile', path)).toBe(true);
    expect(await api(page, 'readPath', path)).toBe(false);
  }
  for (const spec of ['../escape.js', './%2e%2e/escape.js', './..\\\\escape.js', 'https://evil.test/escape.js']) {
    const result = await api(page, 'compileFailure', `import '${spec}';`);
    expect(result.status).toBe('failed');
  }
  expect(escaped).toEqual([]);
  expect((await api(page, 'package', { id: 'integrity-probe', path: 'http://127.0.0.1:4173/__security__/package/valid/' })).error).toBeNull();
});

test('@smoke security: hung activate times out and removes registrations, subscriptions and relay', async ({ page }) => {
  await page.clock.install();
  await api(page, 'install', extension(`ctx.commands.register('temporary',()=>{}); ctx.events.on('tool',()=>{}); await new Promise(()=>{});`));
  await expect.poll(() => api(page, 'status')).toMatchObject({ status: 'starting', commands: ['security-probe:temporary'], subscriptions: 1, relay: 1 });
  await page.clock.fastForward(10_001);
  await expect.poll(() => api(page, 'status')).toMatchObject({ status: 'failed', error: 'activate() timed out', commands: [], callbacks: 0, subscriptions: 0, relay: 0 });
});

test('@smoke security: hung callback fails host and rolls back its open transaction', async ({ page }) => {
  await page.clock.install();
  await api(page, 'install', extension(`ctx.commands.register('temporary',()=>{});ctx.events.on('tool',()=>{});return { hang() {return ctx.sprite.transaction('hung', async tx=>{${write} await new Promise(()=>{});});} };`), ['sprite:write']);
  await api(page, 'ready');
  const before = await api(page, 'status');
  const invocation = api(page, 'invoke', 'hang').catch(e => String(e));
  await expect.poll(() => api(page, 'status')).toMatchObject({ transactions: 1, guards: 1 });
  await expect.poll(async () => (await api(page, 'status')).pixels).not.toEqual(before.pixels);
  await page.clock.fastForward(60_001);
  expect(await invocation).toContain('timed out');
  await expect.poll(() => api(page, 'status')).toMatchObject({ status: 'failed', transactions: 0, guards: 0, callbacks: 0, commands: [], subscriptions: 0, relay: 0, pixels: before.pixels, undo: before.undo, redo: before.redo });
});

test('@smoke security: callback rejection cancels transaction; worker crash rolls back and removes handlers', async ({ page }) => {
  await api(page, 'install', extension(`ctx.commands.register('temporary',()=>{});ctx.events.on('tool',()=>{});return {
    cancel() {return ctx.sprite.transaction('cancel', async tx=>{${write} throw new Error('cancelled fixture');});},
    crash() {return ctx.sprite.transaction('crash', async tx=>{${write} setTimeout(()=>{throw new Error('crash fixture')},0); await new Promise(()=>{});});}
  };`), ['sprite:write']);
  await api(page, 'ready'); const before = await api(page, 'status');
  await expect(api(page, 'invoke', 'cancel')).rejects.toThrow('cancelled fixture');
  expect(await api(page, 'status')).toMatchObject({ status: 'running', pixels: before.pixels, undo: before.undo, redo: before.redo, guards: 0, transactions: 0 });
  await expect(api(page, 'invoke', 'crash')).rejects.toThrow('stopped');
  expect(await api(page, 'status')).toMatchObject({ status: 'failed', pixels: before.pixels, undo: before.undo, redo: before.redo, guards: 0, transactions: 0, commands: [], callbacks: 0, relay: 0, subscriptions: 0 });
});

test('@smoke security: explicit stop cancels transactions and queued iframe RPC cannot resurrect registrations', async ({ page }) => {
  await api(page, 'install', extension(`ctx.commands.register('temporary',()=>{});ctx.events.on('tool',()=>{});return { hang(){ return ctx.sprite.transaction('stop',async tx=>{${write} await new Promise(()=>{});}); } };`), ['sprite:write', 'ui:panel']);
  await api(page, 'ready'); const before = await api(page, 'status');
  await api(page, 'panel', 'panel.html', { 'panel.html': '<body>panel ready</body>' });
  const pending = api(page, 'invoke', 'hang').catch(e=>String(e));
  await expect.poll(() => api(page, 'status')).toMatchObject({ transactions: 1, guards: 1 });
  expect(await api(page, 'stop')).toMatchObject({ status: 'stopped', pixels: before.pixels, undo: before.undo, guards: 0, transactions: 0, commands: [], callbacks: 0, relay: 0 });
  expect(await pending).toContain('stopped');
  await page.frameLocator('#probe-panel').locator('body').evaluate(() => { parent.postMessage({type:'request',id:33,method:'commands.register',params:['resurrect']},'*'); });
  await page.evaluate(() => new Promise(r => setTimeout(r, 30)));
  expect(await api(page, 'status')).toMatchObject({ commands: [], callbacks: 0, transactions: 0 });
});

test('@smoke security: a document decode finishing after stop cannot change editor documents', async ({ page }) => {
  await api(page, 'install', extension(`return {open(raw){return ctx.documents.open({name:'stopped.pixprite',data:new TextEncoder().encode(raw).buffer});}};`), ['sprite:write']);
  await api(page, 'ready'); const before = await api(page, 'status');
  const raw = await api(page, 'holdFile');
  const pending = api(page, 'invoke', 'open', raw).catch(e => String(e));
  await expect.poll(() => api(page, 'status')).toMatchObject({ waitingFile: true });
  await api(page, 'stop');
  expect(await pending).toContain('stopped');
  await api(page, 'releaseFile');
  await expect.poll(() => api(page, 'status')).toMatchObject({ lateCheck: true });
  expect(await api(page, 'status')).toMatchObject({ status: 'stopped', documents: before.documents, pixels: before.pixels });
});

test('@smoke security: extension pixel writes respect layer locks and resume after unlocking', async ({ page }) => {
  await api(page, 'install', extension(`return {async probe() {
    const rect={x:0,y:0,w:1,h:1};
    const put=data=>ctx.sprite.putPixels(0,0,{rect,format:'rgba',data:new Uint8ClampedArray(data)});
    await put([11,22,33,255]);
    await ctx.sprite.layers.update(0,{locked:true});
    let locked='allowed';try{await put([44,55,66,255]);}catch(e){locked=e.code;}
    const unchanged=Array.from((await ctx.sprite.getPixels(0,0,rect)).data);
    await ctx.sprite.layers.update(0,{locked:false});
    await put([44,55,66,255]);
    const updated=Array.from((await ctx.sprite.getPixels(0,0,rect)).data);
    return {locked,unchanged,updated};
  }};`), ['sprite:read', 'sprite:write']);
  await api(page, 'ready');
  expect(await api(page, 'invoke', 'probe')).toEqual({ locked: 'locked', unchanged: [11,22,33,255], updated: [44,55,66,255] });
});
