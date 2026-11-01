import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Tauri requires the resolved Rust runtime and JS API to share a major/minor version. */
export function checkTauriVersions(root = resolve(import.meta.dir, '..')) {
  const lock = readFileSync(resolve(root, 'src-tauri/Cargo.lock'), 'utf8');
  const rust = /^name = "tauri"\r?\nversion = "([^"]+)"/m.exec(lock)?.[1];
  const api = JSON.parse(readFileSync(resolve(root, 'node_modules/@tauri-apps/api/package.json'), 'utf8')).version as string;
  if (!rust || /^\d+\.\d+/.exec(rust)?.[0] !== /^\d+\.\d+/.exec(api)?.[0])
    throw new Error(`Tauri version mismatch: Rust ${rust ?? 'missing from Cargo.lock'} / @tauri-apps/api ${api}. Update both to the same major/minor release.`);
  return { rust, api };
}

if (import.meta.main) {
  const { rust, api } = checkTauriVersions();
  console.log(`PASS Tauri versions: Rust ${rust} / JS API ${api}`);
}
