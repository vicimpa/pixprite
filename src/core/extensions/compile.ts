/**
 * Extensions are kept as source; this turns an entry file into modules a sandboxed page can run.
 * Every file is compiled on its own (TypeScript types stripped by sucrase), its imports followed
 * through the package, and `@pixprite/api` is the editor's own copy of the API. The result is a
 * list of ES modules in dependency order, each import replaced by a `__pxm_<n>__` placeholder;
 * the page links them into blob urls with LINKER (blob urls of the editor's origin are not
 * reachable from an opaque-origin frame, so the linking has to happen inside it).
 */
import { transform } from "sucrase";

// The API sources, as text: extensions get exactly the client this editor speaks to
const API_SOURCES = import.meta.glob<string>('../../../packages/api/src/*.ts', { query: '?raw', import: 'default', eager: true });
const API: Record<string, string> = Object.fromEntries(Object.entries(API_SOURCES).map(([k, v]) => [`@pixprite/api/${k.split('/').pop()}`, v]));

export type Linked = { modules: string[]; };

export class CompileError extends Error { }

/** Reads a package file as text; null when it doesn't exist */
export type ReadText = (path: string) => Promise<string | null>;

const TRY = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

/** `a/b/../c` → `a/c`; null when it climbs out of the package */
function normalize(path: string) {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); }
    else out.push(part);
  }
  return out.join('/');
}

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

// import … from '…' · export … from '…' · import '…' · import('…')
const SPECIFIERS = /(\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\2/g;

/** Compiles `entry` and everything it imports; the entry is the last module */
export async function compile(read: ReadText, entry: string): Promise<Linked> {
  const modules: string[] = [];
  const index = new Map<string, number>();
  const visiting = new Set<string>();
  const texts = new Map<string, string | null>();
  const text = async (path: string) => {
    if (path.startsWith('@pixprite/api/')) return API[path] ?? null;
    if (!texts.has(path)) texts.set(path, await read(path).catch(() => null));
    return texts.get(path)!;
  };

  /** The package path an import points at */
  async function resolve(spec: string, from: string) {
    let base: string | null;
    if (spec === '@pixprite/api' || spec === '@pixprite/api/client') base = `@pixprite/api/${spec.endsWith('client') ? 'client' : 'index'}`;
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      base = from.startsWith('@pixprite/api/') ? `@pixprite/api/${normalize(spec.replace(/^\.\//, ''))}` : normalize(dirOf(from) + spec);
    } else throw new CompileError(`${from}: "${spec}" can't be imported (only files of the extension and @pixprite/api)`);
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
      code = /\.(ts|tsx)$/.test(path)
        ? transform(source, { transforms: ['typescript'], filePath: path, disableESTransforms: true }).code
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
export const LINKER = `self.__pxQueue={items:[],h:function(e){self.__pxQueue.items.push(e);}};addEventListener('message',self.__pxQueue.h);`
  + `function __pxLink(m){var u=[];for(var i=0;i<m.length;i++){u[i]=URL.createObjectURL(new Blob([m[i].replace(/__pxm_(\\d+)__/g,function(_,n){return u[+n];})],{type:'text/javascript'}));}return u[m.length-1];}`;

/** A worker's first script is BOOT_START + JSON of the entry's url + BOOT_END: the same queue, then the module */
export const BOOT_START = `self.__pxQueue={items:[],h:function(e){self.__pxQueue.items.push(e);}};addEventListener('message',self.__pxQueue.h);import(`;
export const BOOT_END = `).catch(function(err){postMessage({type:'failed',error:String(err&&err.stack||err)});});`;

/** The source file of a name the manifest uses: `main.js` → `src/main.ts`, `panel.js` next to a page → `src/panel.ts` */
export async function sourceOf(read: ReadText, file: string): Promise<string | null> {
  const clean = normalize(file);
  if (!clean) return null;
  if (/\.(ts|tsx|mjs)$/.test(clean) && await read(clean) !== null) return clean;
  const base = clean.replace(/\.(js|html)$/, '');
  const dirs = base.startsWith('src/') ? [base] : [`src/${base}`, base];
  for (const b of dirs) for (const e of ['.ts', '.tsx', '.js']) if (await read(b + e).catch(() => null) !== null) return b + e;
  return null;
}
