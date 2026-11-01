import type { TagDirection } from '@pixprite/api';
export type PlayScope = 'tag' | 'loop' | 'all';
export type PlayRange = { from: number; to: number; direction: TagDirection; repeat?: number };
type Playable = { frames: readonly unknown[]; loop: readonly [number, number] | null; playRange(frame: number): PlayRange };

export function playbackRange(sprite: Playable, scope: PlayScope, frame: number): PlayRange {
  const all: PlayRange = { from: 0, to: sprite.frames.length - 1, direction: 'forward' };
  const range = scope === 'all' ? all : scope === 'loop' ? sprite.loop ? { ...all, from: sprite.loop[0], to: sprite.loop[1] } : all : sprite.playRange(frame);
  return { ...range, from: Math.max(0, Math.min(all.to, range.from)), to: Math.max(0, Math.min(all.to, range.to)) };
}

/** One playback clock, independent of frame selection. A seek creates a fresh cursor. */
export class PlaybackCursor {
  frame: number;
  private dir: number;
  private readonly initial: number;
  private passes = 0;
  constructor(readonly range: PlayRange, frame: number) {
    this.frame = Math.max(range.from, Math.min(range.to, frame));
    this.dir = this.initial = range.direction.endsWith('reverse') ? -1 : 1;
  }
  next(once = false): number | null {
    const { from, to, direction, repeat = 0 } = this.range;
    const finish = () => ++this.passes >= (once ? 1 : repeat || Infinity);
    if (from === to) return finish() ? null : this.frame;
    let next = this.frame + this.dir;
    if (direction.startsWith('pingpong')) {
      if (next > to || next < from) { this.dir = -this.dir; next = this.frame + this.dir; }
      // Returning to the starting edge begins the next pass (same order as Sprite.tagSequence).
      const start = this.initial < 0 ? to : from;
      if (next === start && this.dir !== this.initial && finish()) return null;
    } else if (next > to || next < from) {
      if (finish()) return null;
      next = this.dir > 0 ? from : to;
    }
    return this.frame = next;
  }
}
