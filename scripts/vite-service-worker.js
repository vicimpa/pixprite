import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const integrity = bytes => 'sha256-' + createHash('sha256').update(bytes).digest('base64');

/** Hash bytes after Vite has written workers, public files and the final HTML. */
export async function writeServiceWorker(directory) {
  const files = [];
  async function walk(path = '') {
    for (const entry of await readdir(resolve(directory, path), { withFileTypes: true })) {
      const name = path + entry.name;
      if (name.startsWith('.') || name === 'sw.js' || /^precache-.*\.json$/.test(name)) continue;
      if (entry.isDirectory()) await walk(name + '/');
      else files.push([name, integrity(await readFile(resolve(directory, name)))]);
    }
  }
  await walk();
  files.sort(([a], [b]) => a.localeCompare(b));
  const manifest = JSON.stringify(files);
  const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const revision = createHash('sha256').update(template).update(manifest).digest('hex');
  const name = `precache-${revision}.json`;
  await writeFile(resolve(directory, name), manifest);
  await writeFile(resolve(directory, 'sw.js'), template
    .replace('__RELEASE__', revision).replace('__MANIFEST_INTEGRITY__', integrity(manifest)));
}

export function serviceWorker() {
  let output;
  return {
    name: 'pixprite-service-worker', apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    async closeBundle() { await writeServiceWorker(output); },
  };
}
