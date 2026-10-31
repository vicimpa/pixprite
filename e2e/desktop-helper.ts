import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { callDesktop } from '../desktop/connection';

export async function nativeFixture(env: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pixprite-tauri-e2e-'));
  const profile = join(directory, 'profile'), connection = join(directory, 'connection.json');
  const processes: ChildProcess[] = [], logs: string[] = [];
  let knownPid: number | undefined;
  const call = (method: string, params?: Record<string, unknown>) => callDesktop({ method, params }, connection) as Promise<any>;
  async function launch(files: string[] = []) {
    const binary = process.env.PIXPRITE_E2E_EXECUTABLE || resolve(`dist/desktop/pixprite${process.platform === 'win32' ? '.exe' : ''}`);
    const child = spawn(binary, files, { env: { ...process.env, PIXPRITE_USER_DATA: profile,
      PIXPRITE_CONNECTION_FILE: connection, PIXPRITE_DISABLE_UPDATES: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child); child.stdout?.on('data', value => logs.push(String(value))); child.stderr?.on('data', value => logs.push(String(value)));
    child.on('error', error => logs.push(String(error)));
    child.on('exit', code => logs.push(`Native executable exited: ${code}`));
    await ready(); return child;
  }
  async function ready(version?: string) {
    await expect.poll(async () => {
      try { const config = JSON.parse(await readFile(connection, 'utf8')); knownPid = config.pid;
        if (version && config.version !== version) return `version ${config.version}`;
        await call('documents'); return 'ready';
      } catch (error) { return `${String(error)} ${logs.join('').slice(-1000)}`; }
    }, { timeout: 45_000 }).toBe('ready');
  }
  async function exited(child: ChildProcess) {
    if (!child.pid) return;
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null,
      { timeout: 10_000, message: 'The isolated native process must exit before its profile is reused' }).toBe(true);
  }
  async function stop() {
    const child = processes.find(process => process.pid === knownPid);
    try { await call('shutdown'); } catch { /* process can exit before the HTTP response */ }
    await expect.poll(async () => { try { await readFile(connection); return false; } catch { return true; } }).toBe(true);
    if (child) await exited(child);
    knownPid = undefined;
  }
  async function dispose() {
    if (knownPid) { try { await stop(); } catch { try { process.kill(knownPid, 'SIGKILL'); } catch {} } }
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited(child);
    }
    // WebView2 can retain its lockfile briefly after the owning process exits.
    await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
    expect(logs.join(''), 'The native renderer must not report uncaught JavaScript errors').not.toContain('WebView error:');
  }
  return { directory, profile, connection, call, launch, ready, stop, dispose, logs };
}
