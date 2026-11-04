import { expect, mock, test } from 'bun:test';
import type { ExtensionContext } from '../packages/api/src/index';
import { SKILLS, readSkill, skillCatalogue } from '../src/core/automation/skills';
import { toolDefinitions } from '../src/core/automation/catalog';
import { preparePixels, type PixelDocument } from '../src/core/automation/pixels';
import { makeTools } from '../extensions/ai-assistant/src/tools';
import { assistantInstructions } from '../extensions/ai-assistant/src/skills';

const doc: PixelDocument = { width: 32, height: 32, layer: 0, frame: 0, layers: [{ group: false, reference: null }], frames: [{}], lockedDeep: () => false };

test('shared task guides reference real tools and are loaded independently of the catalogue', () => {
  const names = new Set(toolDefinitions.map(tool => tool.name));
  for (const skill of SKILLS) {
    for (const name of skill.tools) expect(names.has(name)).toBe(true);
    expect(readSkill(skill.name)).toBe(skill);
  }
  expect(() => readSkill('unknown')).toThrow('Unknown skill');
  const system = assistantInstructions(skillCatalogue());
  expect(system).toContain('compare-poses');
  expect(system).not.toContain(SKILLS[0].instructions);
});

test('AI adapter uses host schemas and passes independent document contexts without a second tool implementation', async () => {
  const schema = { name: 'pixprite_inspect', description: 'Read', parameters: { type: 'object' }, readOnly: true };
  const list = mock(async () => [schema]);
  const call = mock(async (_name: string, _args?: object) => ({ revision: 7 }));
  const ctx = { automation: { list, call } } as unknown as ExtensionContext;
  const tools = makeTools(ctx, () => false);
  expect((await tools.schemas())[0].function).toEqual({ name: schema.name, description: schema.description, parameters: schema.parameters });
  await tools.schemas(); expect(list).toHaveBeenCalledTimes(1);
  await tools.bind('doc-A', 'chat-A');
  expect(call.mock.calls[0]).toEqual(['pixprite_select', { id: 'doc-A', contextId: 'chat-A', follow: false }]);
  expect(JSON.parse((await tools.run('pixprite_inspect', { documentId: 'doc-A' }, 'chat-A')).content)).toEqual({ revision: 7 });
  expect(call.mock.calls[1]).toEqual(['pixprite_inspect', { documentId: 'doc-A', contextId: 'chat-A', follow: false }]);
});

test('malformed shared hex patches fail before writing or opening history', () => {
  for (const rows of [[], [[]], [['#ff0000'], ['#000000', '']], [['oops']], [['#xyz']], [[null]]]) {
    expect(() => preparePixels(doc, { action: 'write', rows })).toThrow();
  }
  expect(() => preparePixels(doc, { action: 'write', rows: [['#ff0000']], rect: { x: 32, y: 0, w: 1, h: 1 } })).toThrow('fit');
  expect(() => preparePixels(doc, { action: 'write', rows: [['#ff0000']], fill: '#000000' })).toThrow('exactly one');
});

test('shared hex patches preserve alpha and explicit erasures with the same coordinate rules as MCP', () => {
  const result = preparePixels(doc, { action: 'write', rect: { x: 3, y: 4, w: 3, h: 1 }, rows: [['#f008', '', '#01020380']] });
  expect(result.rect).toEqual({ x: 3, y: 4, w: 3, h: 1 });
  expect([...result.data!]).toEqual([255, 0, 0, 136, 0, 0, 0, 0, 1, 2, 3, 128]);
});

test('shared fills reject bad bounds and colors', () => {
  for (const patch of [{ fill: 'red' }, { fill: '#ff0000', rect: { x: -1, y: 0, w: 1, h: 1 } }, { fill: '#ff0000', rect: { x: 0, y: 0, w: 1.5, h: 1 } }])
    expect(() => preparePixels(doc, { action: 'fill', ...patch })).toThrow();
});
