import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const { version: editorVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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
  for (const spec of ['../escape.js', './%2e%2e/escape.js', './..\\\\escape.js', 'https://evil.test/escape.js', '@pixprite/ui/../api', '@pixprite/ui/react', '@pixprite/ui/select', '@pixprite/ui/%2e%2e/escape']) {
    const result = await api(page, 'compileFailure', `import '${spec}';`);
    expect(result.status).toBe('failed');
  }
  expect(escaped).toEqual([]);
  expect((await api(page, 'package', { id: 'integrity-probe', path: 'http://127.0.0.1:4173/__security__/package/valid/' })).error).toBeNull();
});

test('shared UI imports register once across sandbox page scripts and preserve native form events', async ({ page }) => {
  await api(page, 'install', extension('return {};'), ['ui:panel']);
  await api(page, 'ready');
  await api(page, 'panel', 'panel.html', {
    'panel.html': `<head></head><body><form id="form"><label for="choice">Mode</label><px-select id="choice" name="mode"><option value="a">Alpha</option><option value="b">Beta</option></px-select></form><output id="result"></output><script type="module" src="./first.js"></script><script type="module" src="./second.js"></script></body>`,
    'first.js': `import { PxSelect } from '@pixprite/ui'; self.firstSelect = PxSelect; document.body.dataset.first = 'ready';`,
    'second.js': `import { PxSelect } from '@pixprite/ui/elements';
      const field=document.getElementById('choice');
      document.body.dataset.shared=String(PxSelect===customElements.get('px-select'));
      field.addEventListener('change',()=>document.getElementById('result').textContent=new FormData(document.getElementById('form')).get('mode'));
      document.body.dataset.second='ready';`,
  });
  const frame = page.frameLocator('#probe-panel');
  await expect(frame.locator('body')).toHaveAttribute('data-first', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-second', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-shared', 'true');
  await expect(frame.locator('#choice > select')).toBeHidden();
  expect(await frame.locator('body').evaluate(() => (self as any).firstSelect === customElements.get('px-select'))).toBe(true);
  await frame.getByText('Mode', { exact: true }).click();
  await expect(frame.getByRole('listbox')).toHaveCSS('position', 'fixed');
  await frame.locator('[data-select-popup]').getByRole('option', { name: 'Beta', exact: true }).click();
  await expect(frame.locator('output')).toHaveText('b');
  expect(await page.locator('#probe-panel').getAttribute('sandbox')).toBe('allow-scripts');
});

for (const pagePath of ['widget.tsx', 'src/widget.tsx', 'widget.html']) test(`TSX default component mounts with shared React hooks, UI and permission-checked API (${pagePath})`, async ({ page }) => {
  await api(page, 'install', extension('return {};'), ['ui:panel']);
  await api(page, 'ready');
  await api(page, 'panel', pagePath, {
    'src/widget.tsx': `import { useEffect, useState } from 'react';
      import { Button, Input, Select, type ExtensionPageProps } from '@pixprite/ui-react';
      import { Badge } from './parts';
      export default ({ctx}: ExtensionPageProps) => {
        const [count,setCount]=useState(0), [mode,setMode]=useState('a'), [text,setText]=useState('draft'), [error,setError]=useState('');
        useEffect(()=>{document.body.dataset.mounted='yes';return()=>{document.body.dataset.cleaned='yes'}},[]);
        return <><Badge count={count}/><Button onClick={()=>setCount(n=>n+1)}>Increment</Button>
          <Input aria-label="Draft" value={text} onChange={e=>setText(e.target.value)}/><output aria-label="Draft result">{text}</output>
          <Select aria-label="Choice" value={mode} onChange={e=>setMode(e.target.value)}><option value="a">Alpha</option><option value="b">Beta</option></Select>
          <output aria-label="Choice result">{mode}</output><span>{ctx.role}/{ctx.contribution}</span>
          <Button onClick={()=>ctx.sprite.get().catch(e=>setError(e.code))}>Read denied</Button><output aria-label="API result">{error}</output></>;
      };`,
    'src/parts.tsx': `import {useState} from 'react'; export function Badge({count}:{count:number}) {const [suffix]=useState(' clicks'); return <output aria-label="Count">{count}{suffix}</output>}`,
  }, 'widget', pagePath === 'src/widget.tsx');
  const frame = page.frameLocator('#probe-panel');
  await expect(frame.getByLabel('Count', { exact: true })).toHaveText('0 clicks');
  await expect(frame.getByText('widget/probe', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Increment', exact: true }).click();
  await expect(frame.getByLabel('Count', { exact: true })).toHaveText('1 clicks');
  await frame.getByRole('textbox', { name: 'Draft', exact: true }).fill('kept');
  await expect(frame.getByLabel('Draft result')).toHaveText('kept');
  await frame.getByRole('button', { name: 'Choice', exact: true }).click();
  await frame.getByRole('listbox').getByRole('option', { name: 'Beta', exact: true }).click();
  await expect(frame.getByLabel('Choice result')).toHaveText('b');
  await frame.getByRole('button', { name: 'Read denied', exact: true }).click();
  await expect(frame.getByLabel('API result')).toHaveText('permission');
  expect(await page.locator('#probe-panel').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await frame.locator('body').evaluate(() => {try {void parent.document;return 'allowed'}catch(e){return (e as Error).name}})).toBe('SecurityError');
  await expect(frame.locator('body')).toHaveAttribute('data-mounted', 'yes');
  await frame.locator('body').evaluate(() => dispatchEvent(new Event('pagehide')));
  await expect(frame.locator('body')).toHaveAttribute('data-cleaned', 'yes');
  await expect(frame.locator('#root')).toBeEmpty();
});

for (const mode of ['automatic', 'html']) test(`React page accepts a default component without props (${mode})`, async ({ page }) => {
  await api(page, 'install', extension('return {};'), ['ui:panel']);
  await api(page, 'ready');
  await api(page, 'panel', mode === 'automatic' ? 'widget.tsx' : 'custom.html', {
    'src/widget.tsx': `import {useState} from 'react';import {Button} from '@pixprite/ui-react';
      export default () => {const [count,setCount]=useState(0);return <Button onClick={()=>{setCount(n=>n+1);document.body.dataset.shared=String(!self.preloadedHook||self.preloadedHook===useState)}}>Count: {count}</Button>};`,
    'custom.html': '<div id="root"></div><script type="module" src="./preload.js"></script><script type="module" src="./custom.js"></script>',
    'src/preload.ts': "import {useState} from 'react';self.preloadedHook=useState;document.body.dataset.preloaded='yes';",
    'src/custom.ts': "import Page from './widget';import {mountPage} from '@pixprite/ui-react';await mountPage(Page);",
  });
  const frame = page.frameLocator('#probe-panel');
  if (mode === 'html') await expect(frame.locator('body')).toHaveAttribute('data-preloaded', 'yes');
  await frame.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-shared', 'true');
});

for (const phase of ['import', 'render']) test(`TSX ${phase} errors are visible inside the sandbox page`, async ({ page }) => {
  await api(page, 'install', extension('return {};'), ['ui:panel']);
  await api(page, 'ready');
  const source = phase === 'import' ? 'throw new Error("Broken React page");export default () => null;' : 'export default () => {throw new Error("Broken React page")};';
  await api(page, 'panel', 'broken.tsx', { 'src/broken.tsx': source });
  await expect(page.frameLocator('#probe-panel').getByRole('alert')).toContainText('Broken React page');
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

test('@smoke compatibility: rejected extension update leaves the installed version running', async ({ page }) => {
  await api(page, 'install', extension(`return { probe: () => ctx.editorVersion };`), [], { version: '1.0.0', minEditorVersion: '0.0.4' });
  expect((await api(page, 'ready')).status).toBe('running');
  expect(await api(page, 'invoke', 'probe')).toBe(editorVersion);
  await api(page, 'install', extension(`throw new Error('incompatible code ran');`), [], { version: '2.0.0', minEditorVersion: '99.0.0' });
  expect(await api(page, 'result')).toMatchObject({ error: expect.stringContaining('Requires Pixprite 99.0.0'), version: '1.0.0' });
  expect((await api(page, 'status')).status).toBe('running');
  expect(await api(page, 'invoke', 'probe')).toBe(editorVersion);
});

for (const enable of [false, true]) test(`@smoke compatibility: incompatible stored extension cannot ${enable ? 'enable' : 'start or register contributions'}`, async ({ page }) => {
  await api(page, 'install', extension('return {};'), ['ui:panel'], {
    contributes: { commands: [{ id: 'probe', label: 'Must not survive' }], panels: [{ id: 'probe', label: 'Blocked', dock: 'right', page: 'panel.tsx' }] },
  }, { 'src/panel.tsx': 'export default () => null;' });
  await api(page, 'ready');
  const result = await api(page, 'storedMinimum', '99.0.0', enable);
  expect(result.error).toContain('Requires Pixprite 99.0.0');
  expect(result.commands).toEqual([]);
  expect(result.relay).toBe(0);
  expect(result.callbacks ?? 0).toBe(0);
  if (enable) expect(result.enabled).toBe(false);
  else expect(result.status).toBe('failed');
});

test('@smoke compatibility: real Game rig refuses activation when an older editor omits its version', async ({ page }) => {
  const source = async (name: string) => (await page.request.get(`/__e2e__/game-rig/game-rig/src/${name}`)).text();
  const result = await api(page, 'legacyEntry', await source('main.ts'), {
    'rig.ts': await source('rig.ts'), 'zip.ts': await source('zip.ts'),
  });
  expect(result.status).toBe('failed');
  expect(result.error).toContain('Game rig requires Pixprite 0.0.4 or newer');
  expect(result.callbacks).toBe(0);
});

test('extension updates keep a portable offline backup and failed activation restores the running package', async ({ page }) => {
  const version = (v: string) => extension(`return { probe: () => '${v}', write: value => ctx.storage.set('preference',value), read: () => ctx.storage.get('preference') };`);
  await api(page, 'install', version('v1'), ['storage'], { version: '1.0.0' }); await api(page, 'ready');
  await api(page, 'invoke', 'write', 42);
  await api(page, 'install', version('v2'), ['storage'], { version: '2.0.0' });
  expect(await api(page, 'ready')).toMatchObject({ version: '2.0.0', previousVersion: '1.0.0', status: 'running' });
  await api(page, 'restartInstalled');
  expect(await api(page, 'invoke', 'probe')).toBe('v2');
  await api(page, 'install', extension("throw new Error('broken activation');"), ['storage'], { version: '3.0.0' });
  expect(await api(page, 'result')).toMatchObject({ error: expect.stringContaining('Previous version 2.0.0 restored'), version: '2.0.0' });
  expect(await api(page, 'invoke', 'probe')).toBe('v2');
  await page.route('https://**', route => route.abort());
  expect(await api(page, 'rollback')).toMatchObject({ version: '1.0.0', previousVersion: '2.0.0', status: 'running' });
  expect(await api(page, 'invoke', 'probe')).toBe('v1');
  expect(await api(page, 'invoke', 'read')).toBe(42);
});

test('named workspaces restore extension docking, tabs, visibility and editor sizes together', async ({ page }) => {
  const panels = { panels: { 'game-rig/settings': { hidden: false, dock: 'float', x: 80, y: 100, w: 440, h: 300 }, 'missing/info': { hidden: true, dock: 'left' } }, sides: { right: 360 }, tabs: { right: 'game-rig/settings' }, focus: 'game-rig/settings' };
  await api(page, 'workspace', 'edit', { panels, layout: { colorsSize: 300, timelineSize: 260 } });
  await api(page, 'workspace', 'save', { name: 'Rig' });
  await api(page, 'workspace', 'apply', { name: 'Default' });
  expect((await api(page, 'workspace', 'read')).panels.panels).toEqual({});
  await api(page, 'workspace', 'apply', { name: 'Rig' });
  const result = await api(page, 'workspace', 'read');
  expect(result.panels).toEqual(panels);
  expect(result.layout).toMatchObject({ colorsSize: 300, timelineSize: 260 });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).security)).toBe(true);
  const restored = await api(page, 'workspace', 'read');
  expect(restored.panels).toEqual(panels);
  expect(restored.saved.Rig.extensionPanels).toEqual(panels);
});

test('closing during activation keeps the last committed package installed', async ({ page }) => {
  await api(page, 'install', extension("return { probe: () => 'committed' };"), [], { version: '1.0.0' });
  await api(page, 'ready');
  await api(page, 'install', extension('await new Promise(() => {});'), [], { version: '2.0.0' });
  await expect.poll(() => api(page, 'status')).toMatchObject({ version: '2.0.0', status: 'starting' });
  await page.reload(); await expect.poll(() => page.evaluate(() => !!(window as any).security)).toBe(true);
  expect(await api(page, 'restartInstalled')).toMatchObject({ version: '1.0.0', status: 'running' });
  expect(await api(page, 'invoke', 'probe')).toBe('committed');
});

test('updating or restoring a disabled extension does not enable or execute it', async ({ page }) => {
  await api(page, 'install', extension("return {probe: () => 'v1'};"), [], { version: '1.0.0' }); await api(page, 'ready');
  await api(page, 'enabled', false);
  await api(page, 'install', extension("throw new Error('must stay disabled');"), [], { version: '2.0.0' });
  expect(await api(page, 'ready')).toMatchObject({ enabled: false, installedVersion: '2.0.0', relay: 0 });
  expect(await api(page, 'rollback')).toMatchObject({ enabled: false, installedVersion: '1.0.0', relay: 0 });
  expect(await api(page, 'enabled', true)).toMatchObject({ status: 'running', version: '1.0.0' });
});

test('a broken TSX panel import is rejected before replacing the installed package', async ({ page }) => {
  await api(page, 'install', extension("return {probe: () => 'working'};"), ['ui:panel'], { version: '1.0.0' }); await api(page, 'ready');
  await api(page, 'install', extension("return {};"), ['ui:panel'], { version: '2.0.0', contributes: { panels: [{ id: 'chat', label: 'Chat', dock: 'right', page: 'chat.tsx' }] } },
    { 'src/chat.tsx': "import './missing';export default () => null;" });
  expect(await api(page, 'result')).toMatchObject({ error: expect.stringContaining('missing'), version: '1.0.0' });
  expect(await api(page, 'invoke', 'probe')).toBe('working');
});

test('applying a legacy named layout migrates the current extension panel arrangement', async ({ page }) => {
  await api(page, 'workspace', 'legacy');
  const panels = { panels: { 'legacy/panel': { hidden: false, dock: 'right', w: 350 } }, sides: { right: 350 }, tabs: { right: 'legacy/panel' } };
  await api(page, 'workspace', 'edit', { panels });
  const restored = await api(page, 'workspace', 'apply', { name: 'Legacy' });
  expect(restored.panels).toEqual(panels);
  expect(restored.saved.Legacy.extensionPanels).toEqual(panels);
});
