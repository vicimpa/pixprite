import { describe, expect, mock, test } from 'bun:test';

declare global {
  interface Event { persisted?: boolean; }
}

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const tips: string[] = [];
const opened: unknown[] = [];
const state = {
  home: false,
  showTip: (message: string) => { tips.push(message); },
  openDocument: (document: unknown) => { opened.push(document); },
};

mock.module('~/core/State', () => ({ state }));
mock.module('~/core/i18n', () => ({ t: (key: string) => key }));

const { loadFiles } = await import('~/core/Files');

describe('File loading errors', () => {
  test('a corrupted project becomes a readable message without opening a document', async () => {
    tips.length = 0;
    opened.length = 0;
    const file = new File([
      JSON.stringify({ format: 'pixprite', version: 999 }),
    ], 'broken.pixprite', { type: 'application/json' });

    await expect(loadFiles([file])).resolves.toBeUndefined();

    expect(opened).toEqual([]);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain('msg.couldNotOpen');
    expect(tips[0]).toContain('broken.pixprite');
    expect(tips[0]).toContain('Newer pixprite version: 999');
  });
});
