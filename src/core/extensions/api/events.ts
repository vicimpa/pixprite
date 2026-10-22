/**
 * events.subscribe / unsubscribe: editor signals turned into events for one endpoint.
 * Every source skips its first run, so subscribing never fires an event by itself.
 */
import { effect, untracked } from "@preact/signals-react";
import type { EventMap, StateKey } from "@pixprite/api";
import { state } from "~/core/State";
import { DOCUMENTS_CHANGE, SPRITE_EVENTS, statePrefix } from "../protocol";
import { fail, type Handlers } from "./common";
import { activeDoc, docId, docInfo } from "./sprite";
import { readState } from "./ui";

type Emit = (data: unknown) => void;

/** Watches `read`; calls `emit(value)` on each later change */
function watch<T>(read: () => T, emit: (v: T) => void) {
  let first = true;
  return effect(() => {
    const v = read();
    if (first) { first = false; return; }
    untracked(() => emit(v));
  });
}

/** At most one call per `ms`, with the last arguments */
function throttle<T>(fn: (v: T) => void, ms: number) {
  let timer = 0, last: T;
  const out = (v: T) => {
    last = v;
    if (!timer) timer = window.setTimeout(() => { timer = 0; fn(last); }, ms);
  };
  return Object.assign(out, { cancel: () => clearTimeout(timer) });
}

const SOURCES: Record<string, (emit: Emit) => () => void> = {
  'sprite:change': emit => {
    const t = throttle(emit, 50);
    const off = watch(() => [state.sprite, state.sprite.version] as const, ([s]) => t({ document: docId(s) } satisfies EventMap['sprite:change']));
    return () => { t.cancel(); off(); };
  },
  'selection': emit => watch(() => [state.sprite, state.sprite.mask] as const, ([s, m]) =>
    emit({ document: docId(s), bounds: m?.bounds ? { ...m.bounds } : null } satisfies EventMap['selection'])),
  'frame': emit => watch(() => state.sprite.frame, frame => emit({ frame } satisfies EventMap['frame'])),
  'tool': emit => watch(() => state.tool, tool => emit({ tool } satisfies EventMap['tool'])),
  'tags': emit => watch(() => [state.sprite, state.sprite.tags] as const, ([s]) => emit({ document: docId(s) } satisfies EventMap['tags'])),
  'playback': emit => watch(() => state.playing, playing => emit({ playing, frame: state.sprite.frame } satisfies EventMap['playback'])),
  'history': emit => {
    let prev = { doc: state.sprite, done: state.sprite.history.length, undone: state.sprite.future.length };
    return watch(() => [state.sprite, state.sprite.history, state.sprite.future] as const, ([s, done, undone]) => {
      const was = prev;
      prev = { doc: s, done: done.length, undone: undone.length };
      if (was.doc !== s) return;
      const kind: EventMap['history']['kind'] = done.length > was.done && undone.length < was.undone ? 'redo'
        : done.length < was.done ? 'undo' : 'do';
      const label = kind === 'undo' ? undone[0] ?? '' : done[done.length - 1] ?? '';
      if (done.length !== was.done || undone.length !== was.undone) emit({ document: docId(s), label, kind } satisfies EventMap['history']);
    });
  },
  [DOCUMENTS_CHANGE]: emit => watch(() => { const d = activeDoc(); return d && [d, d.name] as const; }, () => {
    const d = activeDoc();
    emit(d && docInfo(d));
  }),
};

for (const key of ['fg', 'bg', 'tool', 'brushSize'] as StateKey[])
  SOURCES[statePrefix + key] = emit => watch(() => readState(key), emit);

export const eventHandlers: Handlers = {
  'events.subscribe': (c, name) => {
    if (typeof name !== 'string' || !SOURCES[name]) fail('not-found', `Unknown event ${name}`);
    if (SPRITE_EVENTS.has(name) && !c.host.can('sprite:read')) fail('permission', 'Permission "sprite:read" is not granted');
    const ep = c.endpoint;
    if (ep.subs.has(name)) return;
    ep.subs.set(name, SOURCES[name](data => ep.post({ type: 'event', event: name, data })));
  },
  'events.unsubscribe': (c, name) => {
    const off = c.endpoint.subs.get(name);
    if (!off) return;
    off();
    c.endpoint.subs.delete(name);
  },
};
