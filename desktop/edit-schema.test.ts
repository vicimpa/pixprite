import { expect, test } from 'bun:test';
import { editOperation } from './edit-schema';
import { toolDefinitions } from './tools';
import { toJSONSchema, safeParse } from 'zod/v4-mini';

test('MCP edits reject values that would make the saved document invalid', () => {
  for (const patch of [{ name: {} }, { visible: 'false' }, { opacity: 255 }, { opacity: -1 }, { blend: 'unknown' }])
    expect(safeParse(editOperation, { method: 'sprite.layers.update', args: [0, patch] }).success).toBe(false);
  expect(safeParse(editOperation, { method: 'sprite.tags.add', args: [{ from: 0, to: 1, color: 'red' }] }).success).toBe(false);
  expect(safeParse(editOperation, { method: 'sprite.layers.add', args: [] }).success).toBe(true);
  expect(safeParse(editOperation, { method: 'sprite.layers.update', args: [0, { name: 'Ink', visible: false, opacity: 0.5, blend: 'multiply' }] }).success).toBe(true);
});

test('published edit args expose heterogeneous items without positional tuples or JSON strings', () => {
  const schema = toJSONSchema(toolDefinitions.find(tool => tool.name === 'pixprite_edit')!.schema, { io: 'input' });
  expect(JSON.stringify(schema)).not.toContain('prefixItems');
  const args = (schema as any).properties.operations.items.properties.args;
  expect(args.type).toBe('array');
  expect(args.items.anyOf.map((item: any) => item.type)).toEqual(expect.arrayContaining(['integer', 'object', 'array']));
  expect(safeParse(editOperation, { method: 'sprite.layers.update', args: ['0', '{"name":"Ink"}'] }).success).toBe(false);
});
