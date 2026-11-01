/** Immutable extension releases on the extensions branch. Network/push is owned by CI. */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildIndex, SRC, type RegistryEntry } from './extensions';
import { compareVersions, isVersion } from '../src/core/extensions/versions';

type Release = Omit<RegistryEntry, 'versions'>;
export const releaseTag = (id: string, version: string) => `ext-${id}-v${version}`;
const sourceCommit = (entry: Release) => /@([a-f0-9]{40})\//.exec(entry.path)?.[1];
const fingerprint = (entry: Release) => JSON.stringify(Object.entries(entry.files).sort(([a], [b]) => a.localeCompare(b)));
const plain = ({ versions: _versions, ...entry }: RegistryEntry): Release => entry;

export function publishExtensions(worktree: string, cdn: string, source = 'local', root = SRC) {
  const out = realpathSync(resolve(worktree));
  const git = (...args: string[]) => execFileSync('git', ['-C', out, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (resolve(git('rev-parse', '--show-toplevel')) !== out || git('branch', '--show-current') !== 'extensions') throw new Error('Publication needs a dedicated extensions worktree');
  if (!/^https:\/\//.test(cdn)) throw new Error('An HTTPS CDN base is required');
  const { registry, problems } = buildIndex(root, [], { publicOnly: true });
  if (problems.length) throw new Error(problems.map(p => `${p.id}: ${p.problems.join('; ')}`).join('\n'));

  const history = new Map<string, Map<string, Release>>();
  // Read previous catalog commits too: this backfills versions published before tags/history existed.
  let commits: string[] = [];
  try { commits = git('log', '--format=%H', '--', 'registry.json').split('\n').filter(Boolean); } catch { /* first publication */ }
  for (const commit of commits) {
    let rows: RegistryEntry[];
    try { const json = JSON.parse(git('show', `${commit}:registry.json`)); rows = Array.isArray(json) ? json : json.extensions; } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) for (const item of [row, ...row.versions ?? []]) {
      if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(item.id) || !isVersion(item.version) || !item.files || !sourceCommit(item)) continue;
      const versions = history.get(item.id) ?? new Map<string, Release>();
      if (!versions.has(item.version)) versions.set(item.version, plain(item));
      history.set(item.id, versions);
    }
  }
  // Validate every release before changing the worktree. Published versions are never overwritten.
  for (const entry of registry.extensions) {
    const previous = history.get(entry.id)?.get(entry.version);
    if (previous && fingerprint(previous) !== fingerprint(entry)) throw new Error(`${entry.id}@${entry.version} is already published with different files; bump its version`);
  }
  for (const versions of history.values()) for (const entry of versions.values()) {
    const tag = releaseTag(entry.id, entry.version);
    let existing: string | undefined;
    try { existing = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`); } catch { /* new tag */ }
    if (existing && existing !== sourceCommit(entry)) throw new Error(`Immutable tag ${tag} points at a different commit`);
  }

  // Keep the old catalog in the sources commit, so its links remain valid during publication.
  const oldCatalog = existsSync(join(out, 'registry.json')) ? git('show', 'HEAD:registry.json') : null;
  for (const file of readdirSync(out)) if (file !== '.git') rmSync(join(out, file), { recursive: true, force: true });
  for (const entry of registry.extensions) for (const path of Object.keys(entry.files)) {
    const to = join(out, entry.id, path); mkdirSync(dirname(to), { recursive: true }); cpSync(join(root, entry.id, path), to);
  }
  if (oldCatalog) writeFileSync(join(out, 'registry.json'), oldCatalog + '\n');
  const commitIfChanged = (message: string) => {
    git('add', '-A');
    try { git('diff', '--cached', '--quiet'); } catch { git('commit', '-m', message); }
  };
  commitIfChanged(`Extension sources from ${source}`);
  const current = git('rev-parse', 'HEAD');
  const extensions = registry.extensions.map(entry => {
    const versions = history.get(entry.id) ?? new Map<string, Release>();
    if (!versions.has(entry.version)) versions.set(entry.version, { ...entry, path: `${cdn.replace(/\/$/, '')}@${current}/${entry.id}/` });
    history.set(entry.id, versions);
    const ordered = [...versions.values()].sort((a, b) => compareVersions(b.version, a.version));
    return { ...ordered[0], versions: ordered };
  });
  writeFileSync(join(out, 'registry.json'), JSON.stringify({ version: 3, extensions }, null, 2) + '\n');
  commitIfChanged(`Extension catalog from ${source}`);
  const tags: string[] = [];
  for (const versions of history.values()) for (const entry of versions.values()) {
    const tag = releaseTag(entry.id, entry.version);
    let target: string | undefined;
    try { target = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`); } catch { /* unpublished */ }
    if (target && target !== sourceCommit(entry)) throw new Error(`Immutable tag ${tag} points at a different commit`);
    if (!target) git('tag', '-a', tag, sourceCommit(entry)!, '-m', `${entry.id} ${entry.version}`);
    tags.push(tag);
  }
  return { extensions, tags };
}

if (import.meta.main) {
  const arg = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
  const out = arg('--worktree'), cdn = arg('--cdn');
  if (!out || !cdn) throw new Error('Usage: publish-extensions.ts --worktree pub --cdn https://cdn.jsdelivr.net/gh/owner/repo [--source sha]');
  const result = publishExtensions(out, cdn, arg('--source'));
  console.log(`Prepared ${result.extensions.length} packages and ${result.tags.length} immutable version tags`);
}
