import { expect, test } from 'bun:test';
import { packFiles, unpackFiles } from './packageStorage';
test('extension files persist as portable bytes and retain MIME types and manifest metadata', async () => {
  const source = { id: 'example', enabled: true, files: { 'main.js': new Blob(['export default 1'], { type: 'text/javascript' }), 'pixels.bin': new Blob([new Uint8Array([0, 128, 255])]) } };
  const stored = await packFiles(source);
  expect(stored.id).toBe('example'); expect(stored.files['main.js']).not.toBeInstanceOf(Blob);
  const loaded = unpackFiles(structuredClone(stored));
  expect(loaded.enabled).toBe(true); expect(loaded.files['main.js'].type).toBe(source.files['main.js'].type);
  expect(await loaded.files['main.js'].text()).toBe('export default 1');
  expect([...new Uint8Array(await loaded.files['pixels.bin'].arrayBuffer())]).toEqual([0, 128, 255]);
  expect(await packFiles(stored)).toEqual(stored);
});
test('older installations with Blob package records remain readable', async () => {
  const loaded = unpackFiles({ id: 'legacy', files: { 'main.js': new Blob(['legacy']) } });
  expect(await loaded.files['main.js'].text()).toBe('legacy');
});
