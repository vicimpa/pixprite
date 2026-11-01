import { expect, test } from '@playwright/test';
import { nativeFixture } from './desktop-helper';

test('native tests keep the single editor hidden while real editing and rendering continue', async () => {
  test.skip(process.env.PIXPRITE_E2E_SHOW_WINDOWS === '1', 'Visible windows were explicitly requested for debugging');
  const f = await nativeFixture();
  try {
    await f.launch();
    const hidden = async () => expect(await f.call('desktop_info')).toMatchObject({ hiddenTestMode: true, windows: 1, window: { visible: false, focused: false } });
    await hidden();
    const doc = await f.call('create', { width: 4, height: 4, name: 'Hidden renderer' });
    await f.call('pixels', { action: 'write', fill: '#ff3366ff' });
    await f.call('select', { id: doc.id });
    const preview = await f.call('preview');
    expect(Buffer.from(preview.image, 'base64').subarray(1, 4).toString()).toBe('PNG');
    await f.call('window_action', { action: 'minimize' }); await hidden();
    const repeated = await f.launch();
    await expect.poll(() => repeated.exitCode, { intervals: [50, 100, 200] }).toBe(0);
    await hidden();
    expect((await f.call('inspect')).name).toBe('Hidden renderer');
  } finally { await f.dispose(); }
});
