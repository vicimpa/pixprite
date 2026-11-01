import { expect, mock, test } from 'bun:test';
import type { ExtensionContext, PixelData, Selection, SpriteSnapshot, Transaction } from '../packages/api/src/index';
import { assistantInstructions, readSkill, SKILLS } from '../extensions/ai-assistant/src/skills';
import { makeTools, TOOL_SCHEMAS } from '../extensions/ai-assistant/src/tools';

function fixture(selection: Selection = { bounds: null, mask: null }) {
  const snapshot = { id: 'sprite-one', name: 'Test', width: 32, height: 32, colorMode: 'rgb', palette: null, transparentIndex: 0, layer: 0, frame: 0, layers: [], frames: [{ duration: 100 }], tags: [], slices: [], loop: null } satisfies SpriteSnapshot;
  const putPixels = mock(async (_layer: number, _frame: number, _pixels: PixelData) => {});
  const transaction = mock(async (_label: string, fn: (tx: Transaction) => Promise<unknown>) => fn({ putPixels } as unknown as Transaction));
  const ctx = { sprite: { get: async () => snapshot, transaction, selection: { get: async () => selection } } } as unknown as ExtensionContext;
  return { tools: makeTools(ctx, () => false), putPixels, transaction };
}

test('every advertised skill is loadable and references only tools available to the assistant', async () => {
  const { tools } = fixture();
  const available = new Set(TOOL_SCHEMAS.map(tool => tool.function.name));
  expect(new Set(SKILLS.map(skill => skill.name)).size).toBe(SKILLS.length);
  const routing = assistantInstructions();
  for (const skill of SKILLS) {
    expect(routing).toContain(skill.name);
    // Progressive disclosure: a request includes the index, not all task instructions.
    expect(routing).not.toContain(skill.instructions);
    const result = JSON.parse((await tools.read_skill({ name: skill.name })).content);
    expect(result.instructions).toBe(skill.instructions);
    for (const name of result.tools) expect(available.has(name)).toBe(true);
  }
  const missing = readSkill('__proto__');
  expect(missing).toHaveProperty('error');
  expect(missing).toHaveProperty('available', SKILLS.map(skill => skill.name));
});

test('malformed pixel patches fail before a transaction can erase or corrupt pixels', async () => {
  const { tools, transaction } = fixture();
  const target = { layer: 0, frame: 0, x: 0, y: 0 };
  for (const rows of [null, [], [[]], [['#fff'], ['#000', '#fff']], [['red']], [[null]], [['#12']], [['#gggggg']]]) {
    await expect(tools.put_pixels({ ...target, rows })).rejects.toThrow();
  }
  await expect(tools.put_pixels({ ...target, x: -1, rows: [['#fff']] })).rejects.toThrow();
  await expect(tools.put_pixels({ ...target, x: .5, rows: [['#fff']] })).rejects.toThrow();
  await expect(tools.put_pixels({ ...target, x: 32, rows: [['#fff']] })).rejects.toThrow();
  expect(transaction).not.toHaveBeenCalled();
});

test('valid pixel patches preserve explicit alpha, transparent cells and canvas coordinates', async () => {
  const { tools, putPixels, transaction } = fixture();
  await tools.put_pixels({ layer: 0, frame: 0, x: 3, y: 4, rows: [['#F08', '#1234', ''], ['#102030', '#AABBCC80', '#00000000']] });
  expect(transaction).toHaveBeenCalledTimes(1);
  const [layer, frame, pixels] = putPixels.mock.calls[0];
  expect([layer, frame]).toEqual([0, 0]);
  expect(pixels.rect).toEqual({ x: 3, y: 4, w: 3, h: 2 });
  expect([...pixels.data]).toEqual([255, 0, 136, 255, 17, 34, 51, 68, 0, 0, 0, 0, 16, 32, 48, 255, 170, 187, 204, 128, 0, 0, 0, 0]);
});

test('fill rectangles reject bad bounds and colors before writing', async () => {
  const { tools, transaction } = fixture();
  const target = { layer: 0, frame: 0, x: 0, y: 0, w: 2, h: 2, color: '#fff' };
  for (const patch of [{ w: 0 }, { h: -1 }, { w: 1000000000 }, { x: -1 }, { y: .1 }, { color: 'rgba(1,2,3,1)' }]) {
    await expect(tools.fill_rect({ ...target, ...patch })).rejects.toThrow();
  }
  expect(transaction).not.toHaveBeenCalled();
});

test('selection inspection distinguishes masks from bounds without flooding model context', async () => {
  const empty = JSON.parse((await fixture().tools.get_selection({})).content);
  expect(empty).toMatchObject({ bounds: null, selectedPixels: 0 });
  const irregular = { bounds: { x: 3, y: 5, w: 2, h: 2 }, mask: new Uint8Array([255, 0, 255, 255]) };
  expect(JSON.parse((await fixture(irregular).tools.get_selection({})).content)).toEqual({ ...irregular, mask: undefined, selectedPixels: 3, rectangular: false, maskRows: [[1, 0], [1, 1]] });
  const large = { bounds: { x: 0, y: 0, w: 100, h: 100 }, mask: new Uint8Array(10000).fill(255) };
  expect(JSON.parse((await fixture(large).tools.get_selection({})).content)).toMatchObject({ selectedPixels: 10000, rectangular: true, maskRows: null });
});
