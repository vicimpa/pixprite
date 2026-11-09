import type { AutomationRequest } from '../../../desktop/protocol';
import * as z from 'zod/v4-mini';
import { editOperation } from './edit-schema';
import { viewOptions } from './automation-schema';
import { base64, bytes, integer, provenance, capturePng, preparePixels, editSelection, compare } from './document';
import { state, bindDocumentPalette, documentPaletteMap } from '../State';
import { samplePerformance } from '../Performance';
import { readDocument } from '../Files';
import { runTask } from '../BackgroundTask';
import { docId, docInfo, spriteHandlers } from '../extensions/api/sprite';
import type { Call } from '../extensions/api/common';
import type { Method } from '../extensions/protocol';
import { listFolders, listProjects, loadProjectData, loadProjectState } from '../Projects';
import { Sprite } from '../Sprite';
import { toolDefinitions } from './catalog';
import { AgentSession } from './Session';
import { documentCommand, documentCommands } from './commands';
import { activeViewer, viewerTabs } from '../ViewerTabs';
import { reportActivity } from './activity';
import { readSkill, skillCatalogue } from './skills';
import { analyze } from './analyze';
import { hasDialogs } from '~/ui/Dialog';

/** One executor shared by native HTTP and the existing extension RPC. */
export function createAutomation(call: Call) {
  const sessions = new Map<string, AgentSession>();
  const handler = (method: string, args: unknown[], context: Call) => {
    const fn = spriteHandlers[method as Method];
    if (!fn) throw new Error(`Unknown document API method: ${method}`);
    return fn(context, ...args);
  };
  async function execute(request: AutomationRequest): Promise<unknown> {
    const entry = toolDefinitions.find(tool => tool.name === request.method || tool.method === request.method);
    const p = entry ? z.parse(entry.schema, request.params ?? {}) as Record<string, unknown> : request.params ?? {};
    const method = entry?.method ?? request.method;
    if (!entry && !['open_data', 'export_data'].includes(method)) throw new Error(`Unknown automation method: ${method}`);
    const key = typeof p.contextId === 'string' ? p.contextId : 'default';
    let session = sessions.get(key);
    if (!session) { session = new AgentSession(call.host.name); sessions.set(key, session); }
    if (method === 'skills') return skillCatalogue();
    if (method === 'read_skill') return readSkill(p.name);
    if (method === 'performance') return samplePerformance(Number(p.durationMs));
    if (method === 'documents') return { documents: state.docs.map(doc => ({ ...docInfo(doc), ...provenance(doc) })), active: state.home || activeViewer.peek() ? null : docId(state.sprite), target: session.documentId ?? null,
      viewers: viewerTabs.peek().map(({ id, name, width, height }) => ({ id, name, width, height, readOnly: true })) };
    if (method === 'library') {
      const [folders, projects] = await Promise.all([listFolders(), listProjects()]);
      if (typeof p.folderId === 'string' && !folders.some(folder => folder.id === p.folderId)) throw new Error('Library folder ID does not exist');
      const filter = String(p.filter ?? '').toLowerCase();
      return { folders: folders.filter(f => (p.folderId === undefined || f.parentId === p.folderId) && f.name.toLowerCase().includes(filter)),
        projects: projects.filter(v => (p.folderId === undefined || (v.folderId ?? null) === p.folderId) && v.name.toLowerCase().includes(filter)).map(({ thumb: _, ...meta }) => meta) };
    }
    if (method === 'compare') {
      const result = await compare(p);
      reportActivity(session.source, undefined, 'compare', result.viewerId && p.follow !== false ? () => { if (!state.textAt && !hasDialogs() && !state.commandPalette) void state.showViewer(result.viewerId!); } : undefined);
      return result;
    }
    const finishOpen = (doc: Sprite) => {
      bindDocumentPalette(doc);
      if (!state.docs.includes(doc)) state.docs = [...state.docs, doc];
      session!.documentId = docId(doc); session!.observe(doc); session!.report(doc, method, p); state.save();
      return session!.describe(doc);
    };
    if (method === 'create') {
      const doc = new Sprite(integer(p.width, 'width', 1, 4096), integer(p.height, 'height', 1, 4096));
      doc.name = String(p.name ?? 'untitled'); bindDocumentPalette(doc);
      if (p.colorMode === 'indexed' || p.colorMode === 'gray') doc.convertColorMode(p.colorMode);
      return finishOpen(doc);
    }
    if (method === 'open_data') {
      if (typeof p.name !== 'string') throw new Error('File name is required');
      return finishOpen(await readDocument(new File([bytes(p.data)], p.name)));
    }
    if (method === 'open_project') {
      const existing = state.docs.find(doc => doc.projectId === p.id);
      if (existing) return finishOpen(existing);
      const raw = await loadProjectData(String(p.id));
      if (!raw) throw new Error('Library project ID does not exist');
      const doc = new Sprite(); await doc.loadAsync(raw);
      doc.projectId = String(p.id); doc.editor = await loadProjectState(String(p.id)); doc.markSaved();
      const opened = state.docs.find(candidate => candidate.projectId === p.id);
      if (opened) return finishOpen(opened);
      return finishOpen(doc);
    }
    if (method === 'select') {
      const doc = session.resolve({ ...p, documentId: p.id });
      session.observe(doc); session.report(doc, method, p);
      return session.describe(doc);
    }
    if (method === 'commands') {
      let doc: Sprite | undefined;
      try { doc = session.resolve(p); } catch { /* Discover commands without an open document. */ }
      const filter = String(p.filter ?? '').toLowerCase();
      return documentCommands(doc).filter(c => `${c.id} ${c.label}`.toLowerCase().includes(filter));
    }
    const isWrite = method === 'edit' || method === 'history' || (method === 'selection' && p.action !== 'copy')
      || (method === 'pixels' && p.action !== 'read') || (method === 'pixels_batch' && Array.isArray(p.operations) && p.operations.some(op => (op as { action: string }).action !== 'read'))
      || (method === 'command' && !String(p.id).startsWith('anim.'));
    const doc = session.resolve(p, isWrite, method === 'history' || (method === 'command' && ['edit.undo', 'edit.redo'].includes(String(p.id)))), cursor = session.cursor(doc);
    const context: Call = { ...call, doc };
    const scoped = <T,>(change: () => T) => session!.scoped(doc, change);
    const transaction = <T,>(label: string, change: (context: Call) => T) => {
      const tx = call.host.beginTransaction(doc);
      try {
        const result = doc.atomicEdit(label, () => scoped(() => change({ ...context, tx })));
        handler('sprite.transaction.end', [tx, true], context);
        return result;
      } catch (error) { handler('sprite.transaction.end', [tx, false], context); throw error; }
    };
    let result: unknown;
    if (method === 'inspect') result = session.describe(doc);
    else if (method === 'preview') {
      const capture = capturePng(doc, p.frame ?? cursor.frame, p.scale, p.layer);
      result = { ...capture.metadata, image: base64(await (await capture.blob).arrayBuffer()) };
      session.observe(doc, capture.metadata.revision);
      session.report(doc, method, p); return result;
    } else if (method === 'export_data') {
      const metadata = { ...provenance(doc), frame: cursor.frame };
      const blob = p.format === 'png' ? await capturePng(doc, cursor.frame, 1, undefined, p.applyPixelRatio === true).blob
        : p.format === 'pixprite' || p.format === 'aseprite' ? await runTask('projectFile', { raw: doc.captureDocument(), format: p.format, palette: doc.paletteHost!.get() })
        : (() => { throw new Error('Unsupported export format'); })();
      return { ...metadata, data: base64(await blob.arrayBuffer()),
        ...(p.format === 'aseprite' && doc.asepriteWarnings.length ? { lossyImport: true, warnings: doc.asepriteWarnings } : {}) };
    } else if (method === 'playback' || (method === 'command' && p.id === 'anim.play')) {
      const action = method === 'command' ? (cursor.playing ? 'pause' : 'play') : p.action;
      session.playback(doc, action);
      result = session.describe(doc);
    } else if (method === 'view') {
      const view = z.parse(z.object(viewOptions), p);
      cursor.frame = integer(view.frame ?? cursor.frame, 'frame', 0, doc.frames.length - 1);
      cursor.layer = integer(view.layer ?? cursor.layer, 'layer', 0, doc.layers.length - 1);
      cursor.view = { ...cursor.view, ...view }; cursor.playing = false;
      result = session.describe(doc);
    } else if (method === 'selection') {
      const run = () => scoped(() => editSelection(doc, p, session!.clipboard));
      result = p.action === 'copy' ? run() : doc.atomicEdit('Agent selection', run);
    }
    else if (method === 'get_selection') {
      const selection = scoped(() => handler('sprite.selection.get', [], context)) as { bounds: { x: number; y: number; w: number; h: number } | null; mask: Uint8Array | null };
      const area = selection.bounds ? selection.bounds.w * selection.bounds.h : 0;
      const selectedPixels = selection.mask ? selection.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0) : area;
      result = { bounds: selection.bounds, selectedPixels, rectangular: area > 0 && selectedPixels === area,
        maskRows: selection.bounds && area <= 4096 ? Array.from({ length: selection.bounds.h }, (_, y) => Array.from({ length: selection.bounds!.w }, (_, x) => !selection.mask || selection.mask[y * selection.bounds!.w + x] ? 1 : 0)) : null };
    } else if (method === 'pixels' || method === 'pixels_batch') {
      const inputs = method === 'pixels' ? [p] : p.operations as unknown[];
      let count = 0;
      const operations = inputs.map(op => {
        const prepared = preparePixels(doc, { layer: cursor.layer, frame: cursor.frame, ...(op as object) });
        count += prepared.rect.w * prepared.rect.h;
        if (count > 1_048_576) throw new Error('Pixel batch exceeds 1,048,576 pixels');
        return prepared;
      });
      const executePixels = (context: Call) => operations.map(op => {
        const { layer, frame, rect } = op;
        cursor.layer = layer; cursor.frame = frame;
        if (isWrite) { doc.palette = documentPaletteMap(doc, frame); doc.frame = frame; doc.layer = layer; }
        if (op.action === 'read') {
          const pixels = handler('sprite.getPixels', [layer, frame, rect, 'rgba'], context) as { data: Uint8ClampedArray };
          return { layer, frame, rect, format: 'rgba', ...(op.encoding === 'hex' ? { encoding: 'hex', rows: hexRows(pixels.data, rect.w, rect.h) } : { data: base64(pixels.data) }) };
        }
        handler('sprite.putPixels', [layer, frame, { rect, format: 'rgba', data: op.data }], context);
        return { layer, frame, rect };
      });
      const results = isWrite ? transaction(String(p.label ?? 'Agent pixels'), executePixels) : executePixels(context);
      const last = operations.at(-1)!; cursor.frame = last.frame; cursor.layer = last.layer;
      result = method === 'pixels' ? { ...results[0], ...provenance(doc) } : { results, ...provenance(doc) };
    } else if (method === 'edit') {
      const operations = (p.operations as unknown[]).map(op => z.parse(editOperation, op));
      const results = transaction(String(p.label ?? 'Agent edit'), context => operations.map(op => handler(op.method, op.args, context)));
      result = { results, document: session.describe(doc) };
    } else if (method === 'history') {
      scoped(() => { if (p.action === 'undo') doc.undo(); else doc.redo(); });
      result = session.describe(doc); state.save();
    } else if (method === 'command') {
      const id = String(p.id);
      if (id === 'file.save') await state.saveDocument(doc);
      else if (id === 'edit.undo' || id === 'edit.redo') scoped(() => documentCommand(doc, id));
      else transaction(`Agent: ${id}`, () => documentCommand(doc, id, p.args as Record<string, unknown> | undefined));
      result = { executed: id, ...session.describe(doc) };
    } else if (method === 'analyze') result = analyze(doc, p);
    else throw new Error(`Unknown automation method: ${method}`);
    session.observe(doc);
    session.report(doc, method, p, method === 'pixels' ? (result as { rect: { x: number; y: number; w: number; h: number } }).rect : undefined);
    return result;
  }
  let queue: Promise<unknown> = Promise.resolve();
  return (request: AutomationRequest) => {
    const operation = queue.then(() => execute(request));
    queue = operation.catch(() => {}); return operation;
  };
}

export function hexRows(data: Uint8ClampedArray, width: number, height: number) {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const i = (y * width + x) * 4;
    return !data[i + 3] ? '' : '#' + [...data.subarray(i, i + (data[i + 3] === 255 ? 3 : 4))].map(hex).join('');
  }));
}
