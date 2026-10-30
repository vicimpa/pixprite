/** Package names are URL-safe relative paths; never decode or normalize untrusted names. */
export const safePath = (p: unknown): p is string => typeof p === 'string' && /^(?!\/)[\w./-]+$/.test(p)
  && !p.split('/').some(part => part === '..' || part === '.') && !p.includes('//');

/** Relative imports may climb inside the package, but never escape its root. */
export function resolvePath(path: string) {
  if (!/^[\w./-]+$/.test(path) || path.startsWith('/')) return null;
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); }
    else out.push(part);
  }
  return out.join('/') || null;
}
