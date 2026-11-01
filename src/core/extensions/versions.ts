/** SemVer without ranges; compare numeric identifiers without losing integer precision. */
const numeric = '(?:0|[1-9]\\d*)';
const identifier = '(?:0|[1-9]\\d*|[\\da-zA-Z-]*[a-zA-Z-][\\da-zA-Z-]*)';
const version = new RegExp(`^(${numeric})\\.(${numeric})\\.(${numeric})(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*)?$`);
export const isVersion = (value: unknown): value is string => typeof value === 'string' && version.test(value);

function integer(a: string, b: string) {
  return a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
}

export function compareVersions(a: string, b: string): number {
  const x = version.exec(a), y = version.exec(b);
  if (!x || !y) throw new Error('Invalid editor version');
  for (let i = 1; i <= 3; i++) { const diff = integer(x[i], y[i]); if (diff) return diff; }
  if (x[4] === y[4]) return 0;
  if (!x[4] || !y[4]) return x[4] ? -1 : 1;
  const left = x[4].split('.'), right = y[4].split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i], r = right[i];
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    return ln && rn ? integer(l, r) : ln !== rn ? ln ? -1 : 1 : l > r ? 1 : -1;
  }
  return 0;
}
