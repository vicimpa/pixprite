/// <reference path="./react-sources.d.ts" />
/**
 * Extensions are kept as source; this turns an entry file into modules a sandboxed page can run.
 * Every file is compiled on its own (TypeScript types stripped by sucrase), its imports followed
 * through the package; `@pixprite/api` and `@pixprite/ui` come from the editor. The result is a
 * list of ES modules in dependency order, each import replaced by a `__pxm_<n>__` placeholder;
 * the page links them into blob urls with LINKER (blob urls of the editor's origin are not
 * reachable from an opaque-origin frame, so the linking has to happen inside it).
 */
import { transform } from "sucrase";
import { resolvePath as normalize, safePath } from './paths';
import REACT_SOURCES from 'virtual:pixprite-react-sources';
import REACT_ENTRY from '../../../packages/ui-react/src/index.ts?raw';
import REACT_PAGE from '../../../packages/ui-react/src/react-page.ts?raw';

// The API sources, as text: extensions get exactly the client this editor speaks to
const API_SOURCES = import.meta.glob<string>('../../../packages/api/src/*.ts', { query: '?raw', import: 'default', eager: true });
const API: Record<string, string> = Object.fromEntries(Object.entries(API_SOURCES).map(([k, v]) => [`@pixprite/api/${k.split('/').pop()}`, v]));
const UI_ROOT = '../../../packages/ui/src/';
const UI_SOURCES = import.meta.glob<string>(['../../../packages/ui/src/**/*.ts', '../../../packages/ui/src/**/*.tsx', '!../../../packages/ui/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
const UI: Record<string, string> = Object.fromEntries(Object.entries(UI_SOURCES).map(([k, v]) => [`@pixprite/ui/${k.slice(UI_ROOT.length)}`, v]));
Object.assign(UI, Object.fromEntries(Object.entries(REACT_SOURCES).map(([name, source]) => [`@pixprite/ui/${name}`, source])), {
  '@pixprite/ui/react-entry.ts': REACT_ENTRY, '@pixprite/ui/react-page.ts': REACT_PAGE,
});

export type Linked = { modules: string[]; };

export class CompileError extends Error { }

/** Reads a package file as text; null when it doesn't exist */
export type ReadText = (path: string) => Promise<string | null>;

const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

// import … from '…' · export … from '…' · import '…' · import('…')
const SPECIFIERS = /(\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\2/g;

/** Compiles `entry` and everything it imports; the entry is the last module */
export async function compile(read: ReadText, entry: string): Promise<Linked> {
  if (!safePath(entry)) throw new CompileError(`Bad entry path "${entry}"`);
  const modules: string[] = [];
  const index = new Map<string, number>();
  const visiting = new Set<string>();
  const texts = new Map<string, string | null>();
  const text = async (path: string) => {
    if (path.startsWith('@pixprite/api/')) return API[path] ?? null;
    if (path.startsWith('@pixprite/ui/')) return UI[path] ?? null;
    if (!texts.has(path)) texts.set(path, await read(path).catch(() => null));
    return texts.get(path)!;
  };

  /** The package path an import points at */
  async function resolve(spec: string, from: string) {
    let base: string | null;
    if (spec === '@pixprite/api' || spec === '@pixprite/api/client') base = `@pixprite/api/${spec.endsWith('client') ? 'client' : 'index'}`;
    else if (spec === '@pixprite/ui-react') base = '@pixprite/ui/react-entry';
    else if (spec === 'react') base = '@pixprite/ui/vendor-react';
    else if (spec === 'react/jsx-runtime') base = '@pixprite/ui/vendor-jsx';
    else if (spec === 'react-dom/client') base = '@pixprite/ui/vendor-client';
    else if (spec === 'react-dom') base = '@pixprite/ui/vendor-dom';
    else if (spec === '@pixprite/ui/react' && from.startsWith('@pixprite/ui/')) base = '@pixprite/ui/react';
    else if (spec === '@pixprite/ui' || spec === '@pixprite/ui/elements' || spec === '@pixprite/ui/legacy') base = `@pixprite/ui/${spec === '@pixprite/ui' ? 'index' : spec.slice('@pixprite/ui/'.length)}`;
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      const builtin = from.startsWith('@pixprite/api/') ? '@pixprite/api/' : from.startsWith('@pixprite/ui/') ? '@pixprite/ui/' : null;
      const relative = normalize(dirOf(builtin ? from.slice(builtin.length) : from) + spec);
      base = relative === null ? null : (builtin ?? '') + relative;
    } else throw new CompileError(`${from}: "${spec}" can't be imported (only extension files and editor-supplied API, UI and React modules)`);
    if (base === null) throw new CompileError(`${from}: "${spec}" is outside the extension`);
    for (const ext of TRY) if (await text(base + ext) !== null) return base + ext;
    throw new CompileError(`${from}: "${spec}" not found`);
  }

  async function load(path: string): Promise<number> {
    const done = index.get(path);
    if (done !== undefined) return done;
    if (visiting.has(path)) throw new CompileError(`Circular import through ${path}`);
    visiting.add(path);
    const source = await text(path);
    if (source === null) throw new CompileError(`${path} not found`);
    let code: string;
    try {
      code = /\.(ts|tsx|jsx)$/.test(path)
        ? transform(source, { transforms: /\.(tsx|jsx)$/.test(path) ? ['typescript', 'jsx'] : ['typescript'], jsxRuntime: 'automatic', production: true, filePath: path, disableESTransforms: true }).code
        : source;
    } catch (e) {
      throw new CompileError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Dependencies first, so each placeholder points at a module linked before this one
    const specs = [...new Set([...code.matchAll(SPECIFIERS)].map(m => m[3]))];
    const targets = new Map<string, number>();
    for (const spec of specs) targets.set(spec, await load(await resolve(spec, path)));
    code = code.replace(SPECIFIERS, (whole, head: string, q: string, spec: string) => `${head}${q}__pxm_${targets.get(spec)}__${q}`);
    visiting.delete(path);
    modules.push(`${code}\n//# sourceURL=${path.startsWith('@') ? path : `ext/${path}`}`);
    index.set(path, modules.length - 1);
    return modules.length - 1;
  }

  const last = await load(normalize(entry) ?? entry);
  if (last !== modules.length - 1) throw new CompileError(`${entry} is imported by its own dependencies`);
  return { modules };
}

/**
 * Script text that defines `__pxLink(modules)`: links the modules into blob urls, returns the entry's.
 * It also starts `__pxQueue`: messages that arrive while the modules load are kept there, and the
 * @pixprite/api client takes them when it starts listening (an entry awaiting `connect()` at its
 * top level finishes loading only after `init`, so they can't wait for the import to finish).
 */
export const LINKER = `if(!self.__pxQueue){self.__pxQueue={items:[],h:function(e){self.__pxQueue.items.push(e);}};addEventListener('message',self.__pxQueue.h);}`
  + `self.__pxBuiltinModules=self.__pxBuiltinModules||Object.create(null);function __pxLink(m){var u=[],c=self.__pxBuiltinModules;for(var i=0;i<m.length;i++){var k=m[i].match(/\\n\\/\\/# sourceURL=(@pixprite\\/(?:api|ui)\\/[^\\n]+)$/);k=k&&k[1];u[i]=k&&c[k]||URL.createObjectURL(new Blob([m[i].replace(/__pxm_(\\d+)__/g,function(_,n){return u[+n];})],{type:'text/javascript'}));if(k)c[k]=u[i];}return u[m.length-1];}`;

let uiRuntime: Promise<Linked> | undefined;
/** One editor-supplied UI runtime, reused by every extension panel in this document. */
export function compileUiRuntime() {
  return uiRuntime ??= compile(async path => path === 'pixprite-ui-runtime.ts'
    ? "import { enhanceLegacyControls } from '@pixprite/ui/legacy'; enhanceLegacyControls();" : null, 'pixprite-ui-runtime.ts');
}

/** A worker's first script is BOOT_START + JSON of the entry's url + BOOT_END: the same queue, then the module */
export const BOOT_START = `self.__pxQueue={items:[],h:function(e){self.__pxQueue.items.push(e);}};addEventListener('message',self.__pxQueue.h);import(`;
export const BOOT_END = `).catch(function(err){postMessage({type:'failed',error:String(err&&err.stack||err)});});`;

/** The source file of a name the manifest uses: `main.js` → `src/main.ts`, `panel.js` next to a page → `src/panel.ts` */
export async function sourceOf(read: ReadText, file: string): Promise<string | null> {
  const clean = normalize(file);
  if (!clean) return null;
  if (/\.(ts|tsx|jsx|mjs)$/.test(clean)) {
    for (const candidate of clean.startsWith('src/') ? [clean] : [`src/${clean}`, clean])
      if (await read(candidate) !== null) return candidate;
    return null;
  }
  const base = clean.replace(/\.(js|html)$/, '');
  const dirs = base.startsWith('src/') ? [base] : [`src/${base}`, base];
  for (const b of dirs) for (const e of ['.ts', '.tsx', '.js']) if (await read(b + e).catch(() => null) !== null) return b + e;
  return null;
}

/** Mount a TSX default export, while keeping all of its modules in the same sandbox linker. */
export function compileReactPage(read: ReadText, source: string) {
  const entry = '__pixprite_react_page__.ts';
  const bootstrap = `import Page from ${JSON.stringify('./' + source)};import { mountPage } from '@pixprite/ui-react';await mountPage(Page);`;
  return compile(path => path === entry ? Promise.resolve(bootstrap) : read(path), entry);
}
