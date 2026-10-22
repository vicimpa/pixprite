import { state } from "~/core/State";
import { effect, untracked } from "@preact/signals-react";

/**
 * Advances frames while `state.playing`, inside the tag / loop section where playback started.
 * Time is accumulated so slow frames are skipped instead of drifting.
 */
export function installPlayback() {
  let timer = 0;
  return effect(() => {
    if (!state.playing) return;
    // Only `playing` drives this effect; everything else is read without subscribing
    return untracked(() => run());
  });

  function run() {
    const { sprite, prefs } = state;
    if (sprite.frames.length < 2) {
      state.playing = false;
      return undefined;
    }
    sprite.dropFloating();
    const startFrame = sprite.frame;
    const range = sprite.playRange(startFrame);
    const reverse = range.direction === 'reverse' || range.direction === 'pingpong-reverse';
    let dir = reverse ? -1 : 1;
    let bounced = false;
    // Tag repeat count: playback stops after that many full passes
    const repeat = Math.max(0, range.repeat ?? 0);
    let passes = 0;
    const passDone = () => repeat > 0 && ++passes >= repeat;
    if (prefs.playOnce) sprite.frame = reverse ? range.to : range.from;
    let last = performance.now();
    let acc = 0;

    const step = () => {
      const { from, to, direction } = range;
      let next = sprite.frame + dir;
      if (direction.startsWith('pingpong') && (next > to || next < from)) {
        // Bounce without repeating the end frame
        dir = -dir;
        next = sprite.frame + dir;
        if (from === to) next = from;
        if (dir === (reverse ? -1 : 1)) {
          bounced = true;
          if (passDone()) return false;
        }
      }
      if (next > to || next < from) {
        if (prefs.playOnce || passDone()) return false;
        next = next > to ? from : to;
      }
      if (prefs.playOnce && direction.startsWith('pingpong') && bounced && next === (reverse ? to : from)) {
        sprite.frame = next;
        return false;
      }
      sprite.frame = next;
      return true;
    };

    const tick = () => {
      const now = performance.now();
      acc += (now - last) * Math.min(4, Math.max(0.1, prefs.playSpeed));
      last = now;
      let guard = 64;
      while (acc >= (sprite.frames[sprite.frame]?.duration ?? 100) && guard--) {
        acc -= sprite.frames[sprite.frame]?.duration ?? 100;
        if (!step()) { state.playing = false; return; }
      }
      timer = window.setTimeout(tick, 8);
    };
    timer = window.setTimeout(tick, 8);

    return () => {
      clearTimeout(timer);
      if (prefs.playOnce || prefs.rewindOnStop) sprite.frame = startFrame;
    };
  }
}
