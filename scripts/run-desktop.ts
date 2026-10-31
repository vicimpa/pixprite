import { resolve } from 'node:path';
const binary = resolve(import.meta.dir, `../dist/desktop/pixprite${process.platform === 'win32' ? '.exe' : ''}`);
const child = Bun.spawn([binary, ...process.argv.slice(2)], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
process.exitCode = await child.exited;
