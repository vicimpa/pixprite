import type { Sprite } from '../Sprite';
import { COMMANDS, commandLabel } from '../Commands';
import { integer } from './document';
import { flipH, flipV, rotate } from '../Image';

const operations: Record<string, (doc: Sprite) => unknown> = {
  'edit.undo': doc => doc.undo(), 'edit.redo': doc => doc.redo(),
  'edit.clear': doc => doc.clearSelection(),
  'edit.flipH': doc => doc.transformSelection('Mirror', flipH),
  'edit.flipV': doc => doc.transformSelection('Mirror', flipV),
  'edit.rotateCw': doc => doc.transformSelection('Turn', b => rotate(b, 1)),
  'edit.rotateCcw': doc => doc.transformSelection('Turn', b => rotate(b, 3)),
  'edit.rotate180': doc => doc.transformSelection('Turn', b => rotate(b, 2)),
  'select.all': doc => doc.selectAll(), 'select.none': doc => doc.deselect(), 'select.invert': doc => doc.invertSelection(),
  'image.flipH': doc => doc.flipSprite('h'), 'image.flipV': doc => doc.flipSprite('v'),
  'image.rotateCw': doc => doc.rotateSprite(1), 'image.rotateCcw': doc => doc.rotateSprite(3), 'image.rotate180': doc => doc.rotateSprite(2),
  'anim.first': doc => { doc.frame = 0; }, 'anim.last': doc => { doc.frame = doc.frames.length - 1; },
  'anim.next': doc => { doc.frame = (doc.frame + 1) % doc.frames.length; },
  'anim.prev': doc => { doc.frame = (doc.frame + doc.frames.length - 1) % doc.frames.length; },
};
export function documentCommands(doc?: Sprite) {
  const size = (key: string, value: number) => ({ key, type: 'number', min: 1, max: 4096, default: value });
  const schemas: Record<string, unknown[]> = {
    'image.pixelRatio': [
      { key: 'x', type: 'number', min: 1, max: 255, default: doc?.pixelRatioX ?? 1 },
      { key: 'y', type: 'number', min: 1, max: 255, default: doc?.pixelRatioY ?? 1 },
    ],
    'image.canvasSize': [size('width', doc?.width ?? 32), size('height', doc?.height ?? 32), ...['anchorX', 'anchorY'].map(key => ({ key, type: 'number', min: 0, max: 1, default: 0.5 }))],
    'image.spriteSize': [size('width', doc?.width ?? 32), size('height', doc?.height ?? 32)],
  };
  return COMMANDS.filter(c => c.id in operations || c.id in schemas || c.id === 'anim.play' || c.id === 'file.save')
    .map(c => ({ id: c.id, label: commandLabel(c), params: schemas[c.id] }));
}
export function documentCommand(doc: Sprite, id: string, args?: Record<string, unknown>) {
  if (id === 'image.pixelRatio') {
    if (!args) throw new Error('This command requires explicit args');
    return doc.setPixelRatio(integer(args.x, 'x', 1, 255), integer(args.y, 'y', 1, 255));
  }
  if (id in operations) { const result = operations[id](doc); doc.dropFloating(); return result; }
  if (id === 'image.canvasSize' || id === 'image.spriteSize') {
    if (!args) throw new Error('This command requires explicit args');
    const width = integer(args.width, 'width', 1, 4096), height = integer(args.height, 'height', 1, 4096);
    if (id === 'image.spriteSize') return doc.scaleSprite(width, height);
    const anchor = (v: unknown) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error('anchor must be 0..1'); return v; };
    return doc.canvasSize(width, height, Math.floor((width - doc.width) * anchor(args.anchorX ?? 0.5)), Math.floor((height - doc.height) * anchor(args.anchorY ?? 0.5)));
  }
  throw new Error('Command is not available in background automation; use the shared document tools');
}
