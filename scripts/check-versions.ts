/**
 * A public extension whose files changed must have a higher version, or editors that have it
 * installed never hear of the update.
 *
 *   bun scripts/check-versions.ts <base ref>     e.g. origin/main in a pull request
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ROOT, SRC } from "./extensions";

const base = process.argv[2];
if (!base) { console.error('Usage: bun scripts/check-versions.ts <base ref>'); process.exit(2); }

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const changed = new Set(git('diff', '--name-only', `${base}...HEAD`, '--', 'extensions/')
  .split('\n').filter(Boolean).map(p => p.split('/')[1]).filter(Boolean));

/** 1.10.0 > 1.9.2; pre-release and build tails are ignored */
const newer = (a: string, b: string) => {
  const pa = a.split(/[-+]/)[0].split('.').map(Number), pb = b.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

let failed = 0;
for (const id of [...changed].sort()) {
  const file = join(SRC, id, 'manifest.json');
  if (!existsSync(file)) { console.log(`- ${id}: removed`); continue; }
  const now = JSON.parse(readFileSync(file, 'utf8'));
  if (now.public === false) { console.log(`- ${id}: not public`); continue; }
  let before: { version?: string; public?: boolean; } | null = null;
  try { before = JSON.parse(git('show', `${base}:extensions/${id}/manifest.json`)); } catch { /* new */ }
  if (!before) { console.log(`✓ ${id}: new, ${now.version}`); continue; }
  if (before.public === false) { console.log(`✓ ${id}: published for the first time, ${now.version}`); continue; }
  if (newer(now.version, before.version ?? '0.0.0')) console.log(`✓ ${id}: ${before.version} → ${now.version}`);
  else { console.log(`✗ ${id}: files changed but the version is still ${now.version} (was ${before.version})`); failed++; }
}
if (!changed.size) console.log('No extension changed');
process.exit(failed ? 1 : 0);
