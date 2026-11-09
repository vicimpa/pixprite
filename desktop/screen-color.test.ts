import { expect, test } from 'bun:test';
import { pickScreenColor } from './screen-color';

test('native screen picker passes RGB/cancellation through and removes its abort listener', async () => {
  for (const color of ['#123456', null]) {
    const controller = new AbortController();
    const calls: string[] = [];
    const invoke = async <T>(command: string) => { calls.push(command); return color as T; };
    expect(await pickScreenColor(invoke, controller.signal)).toBe(color);
    controller.abort();
    expect(calls).toEqual(['desktop_pick_screen_color']);
  }
});

test('native screen picker never starts with an already cancelled signal', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const invoke = async <T>() => { calls++; return null as T; };
  await expect(pickScreenColor(invoke, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(0);
});

test('native screen cancellation uses the original request ID and rejects a late selected color', async () => {
  const controller = new AbortController();
  const calls: { command: string; id: unknown }[] = [];
  let finish!: (value: string | null) => void;
  const invoke = <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ command, id: args.requestId });
    if (command === 'desktop_cancel_screen_color') return Promise.resolve(undefined as T);
    return new Promise<string | null>(resolve => { finish = resolve; }) as Promise<T>;
  };
  const pending = pickScreenColor(invoke, controller.signal);
  controller.abort(); finish('#abcdef');
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls.map(call => call.command)).toEqual(['desktop_pick_screen_color', 'desktop_cancel_screen_color']);
  expect(calls[1].id).toBe(calls[0].id);
  expect(calls[0].id).toMatch(/^[\da-f-]{36}$/);
});
