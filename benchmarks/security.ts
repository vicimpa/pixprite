import { restorePanelLayout, panelLayout } from '../src/core/extensions/panels';
import { API_VERSION, type Permission, type Manifest } from '../packages/api/src';
import { state } from '../src/core/State';
import { commands } from '../src/core/Commands';
import { ExtensionHost } from '../src/core/extensions/Host';
import { framePage, loadContributions } from '../src/core/extensions/Contributions';
import { hosts } from '../src/core/extensions/api/common';
import { installed, installFromFiles, installFromRegistry, lifecycle, readFile, setEnabled, rollbackExtension, loadInstalled, type RegistryEntry } from '../src/core/extensions/Registry';
import { startExtension, stopExtension, validateExtension } from '../src/core/extensions/Runtime';

lifecycle.validate = validateExtension;
lifecycle.start = startExtension;
lifecycle.stop = stopExtension;
state.setPrefs({ autosave: false, historyMB: 0, historyOperationMB: 0 });
state.newDocument().reset(2, 2, 'Security');

let current: ExtensionHost | undefined;
let installation: Promise<unknown> | undefined;
let releaseFile: (() => void) | undefined;
let waitingFile = false;
let lateCheck = false;
const api = {
  async install(source: string, permissions: Permission[] = [], extra: Partial<Manifest> = {}, files: Record<string, string> = {}) {
    const manifest = { id: 'security-probe', name: 'Security probe', version: '1.0.0', apiVersion: API_VERSION, entry: 'main.js', permissions, ...extra };
    const contents = { 'manifest.json': JSON.stringify(manifest), 'main.js': source, ...files };
    installation = installFromFiles(Object.fromEntries(Object.entries(contents).map(([k, v]) => [k, new Blob([v])])));
    // Starting may intentionally hang: observe the real host without awaiting activation.
    void installation.catch(() => {});
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 0)); current = hosts.get(manifest.id); if (current) break; }
    return !!current;
  },
  async ready() { await installation; current = hosts.get('security-probe'); return api.status(); },
  async result() {
    try { await installation; current = hosts.get('security-probe'); return { error: null, version: current?.manifest.version }; }
    catch (error) { current = hosts.get('security-probe'); return { error: String(error), version: installed.peek().find(e => e.id === 'security-probe')?.manifest.version }; }
  },
  async enabled(value: boolean) { await setEnabled('security-probe', value); current = hosts.get('security-probe'); return api.status(); },
  async rollback() { await rollbackExtension('security-probe'); current = hosts.get('security-probe'); return api.status(); },
  async restartInstalled() {
    await stopExtension('security-probe');
    const list = await loadInstalled(), ext = list.find(e => e.id === 'security-probe')!;
    await startExtension(ext); current = hosts.get(ext.id); return api.status();
  },
  workspace(action: string, data: any = {}) {
    if (action === 'edit') { restorePanelLayout(data.panels); state.setLayout(data.layout ?? {}); }
    if (action === 'save') state.saveLayoutAs(data.name);
    if (action === 'legacy') state.savedLayouts = { ...state.savedLayouts, Legacy: { ...state.layout, extensionPanels: undefined } };
    if (action === 'apply') state.applyLayout(data.name);
    return { layout: state.layout, panels: panelLayout.peek(), name: state.layoutName, saved: state.savedLayouts };
  },
  async storedMinimum(minEditorVersion: string, enable = false) {
    const ext = { ...current!.ext, manifest: { ...current!.manifest, minEditorVersion }, enabled: !enable };
    await stopExtension(ext.id);
    installed.value = installed.peek().map(e => e.id === ext.id ? ext : e);
    let error: string | null = null;
    try { if (enable) await setEnabled(ext.id, true); else await startExtension(ext); }
    catch (e) { error = String(e); }
    current = hosts.get(ext.id);
    return { ...api.status(), error: error ?? current?.error.peek(), enabled: installed.peek().find(e => e.id === ext.id)?.enabled };
  },
  status() {
    current = hosts.get('security-probe') ?? current;
    const doc = state.sprite;
    return { enabled: installed.peek().find(e => e.id === 'security-probe')?.enabled, installedVersion: installed.peek().find(e => e.id === 'security-probe')?.manifest.version, version: current?.manifest.version, previousVersion: installed.peek().find(e => e.id === 'security-probe')?.previous?.manifest.version, status: current?.status.peek(), error: current?.error.peek(), callbacks: current?.callbacks.size, transactions: current?.transactions.size,
      commands: [...commands.keys()].filter(k => k.startsWith('security-probe:')), subscriptions: (current as any)?.worker?.subs.size ?? 0,
      relay: document.querySelectorAll('iframe[aria-hidden=true]').length, guards: doc.historyGuardCount, pixels: Array.from(doc.canvasPixels()), undo: doc.history.length, redo: doc.future.length, documents: state.docs.length, waitingFile, lateCheck };
  },
  invoke(name: string, ...args: unknown[]) { return current!.invoke('export', name, ...args); },
  stop() { current!.dispose(); return api.status(); },
  holdFile() {
    const host = current!, assertActive = host.assertActive.bind(host);
    // Observe the real lifetime gate without changing its result or the decoder.
    host.assertActive = () => { if (host.lifetime.signal.aborted) lateCheck = true; assertActive(); };
    const original = File.prototype.text;
    const held = new Promise<void>(resolve => releaseFile = resolve);
    File.prototype.text = async function () {
      if (this.name === 'stopped.pixprite') { waitingFile = true; await held; }
      return original.call(this);
    };
    return JSON.stringify(state.sprite.toJSON());
  },
  releaseFile() { releaseFile?.(); },
  async panel(page: string, files: Record<string, string> = {}, role: 'panel' | 'widget' = 'panel', connectAfterLoad = false) {
    const host = current!;
    Object.assign(host.ext.files, Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Blob([v])])));
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts');
    if (!connectAfterLoad) host.connectFrame(iframe, role, 'probe');
    const loaded = new Promise<void>(resolve => iframe.addEventListener('load', () => resolve(), { once: true }));
    iframe.srcdoc = (await framePage(host.ext, page)).srcdoc;
    iframe.id = 'probe-panel'; document.body.appendChild(iframe);
    if (connectAfterLoad) { await loaded; host.connectFrame(iframe, role, 'probe'); }
    return true;
  },
  async package(entry: RegistryEntry) {
    try { await installFromRegistry(entry); return { error: null }; }
    catch (error) { return { error: String(error), installed: installed.peek().some(e => e.id === entry.id), running: hosts.has(entry.id) }; }
  },
  async badFile(path: string) {
    try { await installFromFiles({ 'manifest.json': new Blob([JSON.stringify({ id: 'bad-path', name: 'Bad', version: '1.0.0', apiVersion: API_VERSION })]), [path]: new Blob(['secret']) }); return false; }
    catch { return true; }
  },
  async readPath(path: string) { return (await readFile({ ...current!.ext, source: 'dev', url: location.origin + '/__security__/package/' }, path)) !== null; },
  async compileFailure(source: string) {
    const host = new ExtensionHost({ id: 'compile-probe', manifest: { id: 'compile-probe', name: 'Compile', version: '1.0.0', apiVersion: API_VERSION, entry: 'main.js' }, files: { 'main.js': new Blob([source]) }, source: 'file', enabled: true, installedAt: 0 });
    await loadContributions(host); await host.start(); return { status: host.status.peek(), error: host.error.peek() };
  },
  async legacyEntry(source: string, files: Record<string, string>) {
    const host = new ExtensionHost({ id: 'legacy-probe', manifest: { id: 'legacy-probe', name: 'Legacy', version: '1.0.0', apiVersion: API_VERSION, entry: 'main.js' },
      files: Object.fromEntries(Object.entries({ 'main.ts': source, ...files }).map(([path, text]) => [`src/${path}`, new Blob([text])])), source: 'file', enabled: true, installedAt: 0 });
    // A host from before 0.0.4 sends no editorVersion in its init message.
    const init = (host as any).init.bind(host);
    (host as any).init = (...args: unknown[]) => { const message = init(...args); delete message.editorVersion; return message; };
    try {
      await host.start();
      return { status: host.status.peek(), error: host.error.peek(), callbacks: host.callbacks.size };
    } finally { host.dispose(); }
  },
};
(window as any).security = api;
