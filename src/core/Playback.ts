import { state } from '~/core/State';
import { effect, untracked } from '@preact/signals-react';
import { PlaybackCursor, playbackRange } from './PlaybackCursor';

/** Accumulate frame time; a manual seek resets the clock without toggling playback. */
export function installPlayback() {
  return effect(() => {
    if (!state.playing) return;
    return untracked(() => {
      const sprite = state.sprite, startFrame = sprite.frame;
      if (sprite.frames.length < 2) { state.playing = false; return; }
      sprite.dropFloating();
      let anchor = sprite.frame;
      let range = playbackRange(sprite, state.prefs.playScope, anchor);
      if (state.prefs.playOnce) sprite.frame = range.direction.endsWith('reverse') ? range.to : range.from;
      let cursor = new PlaybackCursor(range, sprite.frame), expected = cursor.frame;
      let last = performance.now(), acc = 0, timer = 0;
      const tick = () => {
        if (state.sprite !== sprite) { state.playing = false; return; }
        const now = performance.now(), prefs = state.prefs;
        const seek = sprite.frame !== expected;
        if (seek) anchor = sprite.frame;
        const updated = playbackRange(sprite, prefs.playScope, anchor);
        if (seek || updated.from !== range.from || updated.to !== range.to || updated.direction !== range.direction || updated.repeat !== range.repeat) {
          range = updated; cursor = new PlaybackCursor(range, sprite.frame);
          sprite.frame = expected = cursor.frame; acc = 0; last = now;
        }
        acc += (now - last) * Math.min(4, Math.max(0.1, prefs.playSpeed)); last = now;
        let guard = 64;
        while (acc >= (sprite.frames[sprite.frame]?.duration ?? 100) && guard--) {
          acc -= sprite.frames[sprite.frame]?.duration ?? 100;
          const next = cursor.next(prefs.playOnce);
          if (next === null) { sprite.frame = cursor.frame; state.playing = false; return; }
          sprite.frame = expected = next;
        }
        timer = window.setTimeout(tick, 8);
      };
      timer = window.setTimeout(tick, 8);
      return () => {
        clearTimeout(timer);
        if (state.sprite === sprite && state.prefs.rewindOnStop) sprite.frame = Math.min(startFrame, sprite.frames.length - 1);
      };
    });
  });
}
