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
  let primary: ChildProcess | undefined;
  const timings: { phase: string; ms: number }[] = [];
  const call = (method: string, params?: Record<string, unknown>) => callDesktop({ method, params }, connection) as Promise<any>;
  async function launch(files: string[] = [], flags = ['--mcp', '--mcp-port', '0'], waitForMcp = !flags.includes('--no-mcp'), cwd?: string) {
    const started = performance.now();
    const binary = resolve(process.env.PIXPRITE_E2E_EXECUTABLE || `dist/desktop/pixprite${process.platform === 'win32' ? '.exe' : ''}`);
    const child = spawn(binary, [...flags, ...files], { env: { ...process.env, PIXPRITE_USER_DATA: profile,
      PIXPRITE_CONNECTION_FILE: connection, PIXPRITE_DISABLE_UPDATES: '1',
      PIXPRITE_E2E_HIDDEN: process.env.PIXPRITE_E2E_SHOW_WINDOWS === '1' ? '0' : '1', ...env },
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    primary ??= child; knownPid = primary.pid;
    processes.push(child); child.stdout?.on('data', value => logs.push(String(value))); child.stderr?.on('data', value => logs.push(String(value)));
    child.on('error', error => logs.push(String(error)));
    child.on('exit', code => logs.push(`Native executable exited: ${code}`));
    if (waitForMcp) await ready();
    else await expect.poll(async () => {
      try { return Array.isArray(JSON.parse(await readFile(join(profile, 'window.json'), 'utf8')).session?.tabs); }
      catch { return false; }
    }, { timeout: 45_000, intervals: [50, 100, 200] }).toBe(true);
    timings.push({ phase: 'launch', ms: Math.round(performance.now() - started) });
    return child;
  }
  async function ready(version?: string) {
    await expect.poll(async () => {
      try { const config = JSON.parse(await readFile(connection, 'utf8'));
        if (version && config.version !== version) return `version ${config.version}`;
        await call('documents'); return 'ready';
      } catch (error) { return `${String(error)} ${logs.join('').slice(-1000)}`; }
    }, { timeout: 45_000, intervals: [50, 100, 200] }).toBe('ready');
  }
  async function exited(child: ChildProcess) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const finished = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { child.off('exit', finished); reject(new Error('The isolated native process did not exit')); }, 10_000);
      child.once('exit', finished);
    });
  }
  async function stop() {
    const started = performance.now();
    const child = processes.find(process => process.pid === knownPid);
    try { await readFile(connection); } catch {
      child?.kill('SIGTERM'); if (child) await exited(child);
      knownPid = undefined; primary = undefined; return;
    }
    try { await call('shutdown'); } catch { /* process can exit before the HTTP response */ }
    if (child) await exited(child);
    await expect.poll(async () => { try { await readFile(connection); return false; } catch { return true; } }, { intervals: [20, 50, 100] }).toBe(true);
    timings.push({ phase: 'stop', ms: Math.round(performance.now() - started) });
    knownPid = undefined; primary = undefined;
  }
  async function dispose() {
    if (knownPid) { try { await stop(); } catch { try { process.kill(knownPid, 'SIGKILL'); } catch {} } }
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited(child);
    }
    // WebView2 can retain its lockfile briefly after the owning process exits.
    await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
    if (process.env.PIXPRITE_E2E_TIMINGS === '1') console.log('Native timings: ' + timings.map(({ phase, ms }) => `${phase} ${ms} ms`).join(', '));
    expect(logs.join(''), 'The native renderer must not report uncaught JavaScript errors').not.toContain('WebView error:');
  }
  return { directory, profile, connection, call, launch, ready, stop, dispose, logs, timings };
}
