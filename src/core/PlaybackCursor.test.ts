import { expect, test } from 'bun:test';
import { PlaybackCursor, playbackRange, type PlayRange } from './PlaybackCursor';

const frames = (range: PlayRange, once = false) => {
  const cursor = new PlaybackCursor(range, range.direction.endsWith('reverse') ? range.to : range.from);
  const values = [cursor.frame];
  for (let i = 0; i < 30; i++) { const next = cursor.next(once); if (next === null) { if (values.at(-1) !== cursor.frame) values.push(cursor.frame); return values; } values.push(next); }
  throw new Error('Playback should have stopped');
};
test('playback covers forward, reverse and ping-pong passes including two-frame tags', () => {
  expect(frames({ from: 2, to: 4, direction: 'forward', repeat: 2 })).toEqual([2, 3, 4, 2, 3, 4]);
  expect(frames({ from: 2, to: 4, direction: 'reverse' }, true)).toEqual([4, 3, 2]);
  expect(frames({ from: 2, to: 4, direction: 'pingpong', repeat: 2 })).toEqual([2, 3, 4, 3, 2, 3, 4, 3]);
  expect(frames({ from: 2, to: 3, direction: 'pingpong-reverse', repeat: 2 })).toEqual([3, 2, 3, 2]);
  expect(frames({ from: 5, to: 5, direction: 'pingpong', repeat: 3 })).toEqual([5, 5, 5]);
});
test('a manual seek starts the chosen tag afresh and scope distinguishes tags, loops and all frames', () => {
  const sprite = { frames: Array(8), loop: [1, 6] as [number, number], playRange: (frame: number): PlayRange => frame < 4
    ? { from: 0, to: 3, direction: 'forward' } : { from: 4, to: 7, direction: 'reverse' } };
  expect(playbackRange(sprite, 'all', 5)).toEqual({ from: 0, to: 7, direction: 'forward' });
  expect(playbackRange(sprite, 'loop', 5)).toEqual({ from: 1, to: 6, direction: 'forward' });
  const cursor = new PlaybackCursor(playbackRange(sprite, 'tag', 5), 5);
  expect(cursor.next()).toBe(4); expect(cursor.next()).toBe(7);
  expect(new PlaybackCursor(playbackRange(sprite, 'tag', 2), 2).next()).toBe(3);
});
