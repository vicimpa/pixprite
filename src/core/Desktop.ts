import type { AutomationRequest, DesktopFile } from '../../desktop/protocol';
import { state, flushEditorSettings } from './State';
import { loadFiles } from './Files';
import { ExtensionHost } from './extensions/Host';
import { windowSessionKey, windowRunningKey } from './WindowSession';
import { bytes } from './automation/data';
import { createAutomation } from './automation/execute';

export function installDesktop(ready: Promise<unknown>) {
  const bridge = window.pixpriteDesktop;
  if (!bridge) return;
  window.addEventListener('pixprite:notice', event => state.showTip(String((event as CustomEvent).detail), 5000));
  const host = new ExtensionHost({ id: 'local-mcp', manifest: { id: 'local-mcp', name: 'Local MCP', version: '1.0.0', apiVersion: 1, permissions: ['sprite:read', 'sprite:write'] }, files: {}, source: 'file', enabled: true, installedAt: 0 });
  const automation = createAutomation({ host, endpoint: { role: 'worker', post() {}, subs: new Map() } });
  async function execute({ method, params = {} }: AutomationRequest) {
    if (method === 'prepare_close') {
      await state.persist();
      flushEditorSettings();
      const session = JSON.parse(localStorage.getItem(windowSessionKey()) ?? 'null');
      if (!session || state.docs.some(doc => !doc.sessionId || doc.storedVersion !== doc.version || !session.tabs?.includes(doc.sessionId))
        || session.active !== (state.home ? 'home' : state.sprite.sessionId)) throw new Error('Could not save the complete session; the editor will stay open');
      if (method === 'prepare_close') localStorage.removeItem(windowRunningKey());
      return { saved: true };
    }
    return automation({ method, params });
  }
  let queue: Promise<unknown> = ready;
  const enqueue = <T>(fn: () => Promise<T>) => {
    const operation = queue.then(fn);
    queue = operation.catch(() => {});
    return operation;
  };
  bridge.onRequest(request => enqueue(() => execute(request)));
  bridge.onFiles((files: DesktopFile[]) => enqueue(async () => {
    await loadFiles(files.map(file => new File([bytes(file.data)], file.name)), undefined, 'tabs');
  }));
}
