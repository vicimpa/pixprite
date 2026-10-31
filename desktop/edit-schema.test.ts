import { expect, test } from 'bun:test';
import { editOperation } from './edit-schema';

test('MCP edits reject values that would make the saved document invalid', () => {
  for (const patch of [{ name: {} }, { visible: 'false' }, { opacity: 255 }, { opacity: -1 }, { blend: 'unknown' }])
    expect(editOperation.safeParse({ method: 'sprite.layers.update', args: [0, patch] }).success).toBe(false);
  expect(editOperation.safeParse({ method: 'sprite.tags.add', args: [{ from: 0, to: 1, color: 'red' }] }).success).toBe(false);
  expect(editOperation.safeParse({ method: 'sprite.layers.add', args: [] }).success).toBe(true);
  expect(editOperation.safeParse({ method: 'sprite.layers.update', args: [0, { name: 'Ink', visible: false, opacity: 0.5, blend: 'multiply' }] }).success).toBe(true);
});
