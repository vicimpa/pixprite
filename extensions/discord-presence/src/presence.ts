/**
 * Turns what the editor knows about the active document into one Discord activity.
 * Pure on purpose: the worker and the panel preview use the same function and the tests
 * cover every state (no document, editing, animation playback, selection, idle, privacy).
 */

import { SITE_URL, type ActivityType, type Settings } from './config';
import type { SpriteSnapshot, DocumentInfo } from '@pixprite/api';

/** Discord rejects longer text; it also hides fields shorter than two characters */
export const MAX_TEXT = 128;
export const MIN_TEXT = 2;

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type PresenceTag = { name: string; from: number; to: number };

export type PresenceDoc = {
  name: string;
  width: number;
  height: number;
  /** Visible drawing layers (groups are not counted) */
  layers: number;
  frames: number;
  tags: PresenceTag[];
  frame: number;
  dirty: boolean;
};

export type PresenceInput = {
  doc: PresenceDoc | null;
  /** Editor tool id, e.g. `pencil` */
  tool: string;
  playing: boolean;
  selection: { w: number; h: number } | null;
  idle: boolean;
  /** Threshold that produced `idle`, for the text */
  idleMinutes: number;
  /** Session timing: when the shown session started and the moment it was built */
  timing: SessionTiming;
};

/** When the shown session started and the moment it was built */
export type SessionTiming = { startedAt: number; now: number };

export type DiscordAsset = {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
};

export type DiscordActivity = {
  type: ActivityType;
  details?: string;
  state?: string;
  timestamps?: { start: number };
  assets?: DiscordAsset;
  buttons?: { label: string; url: string }[];
};

/** Discord's text limits: trim, collapse line breaks, keep two characters when possible */
export function clip(value: string, max = MAX_TEXT): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** A tag of the frame being edited or played, if any */
export function tagAt(doc: PresenceDoc, frame = doc.frame): PresenceTag | null {
  return doc.tags.find(tag => frame >= tag.from && frame <= tag.to) ?? null;
}

/** The core (editor) name of a tool, or a readable fallback for extension tools */
export function toolName(tool: string, core: (key: string) => string): string {
  const key = `tool.${tool}`;
  const label = core(key);
  if (label && label !== key) return label;
  const name = tool.split(/[.:]/).pop() || tool;
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

/**
 * The activity to send, or `null` when there is nothing to show (no text at all).
 * `details` is the file line, `state` is what is happening in it.
 */
export function buildActivity(input: PresenceInput, settings: Settings, t: Translate, core: Translate): DiscordActivity | null {
  const doc = input.doc;
  const { display } = settings;
  const details = doc
    ? clip(display.showFile ? doc.name || t('details.untitled') : t('details.project'))
    : clip(t('details.none'));

  let state: string;
  if (!doc) {
    state = t('state.none');
  } else if (input.idle && input.idleMinutes > 0) {
    state = t('state.idle', { min: input.idleMinutes });
  } else if (input.playing) {
    const tag = tagAt(doc);
    state = tag
      ? t('state.playingTag', { tag: tag.name, frame: doc.frame + 1, total: doc.frames })
      : t('state.playing', { frame: doc.frame + 1, total: doc.frames });
  } else {
    const parts: string[] = [];
    if (display.showTool && input.tool) parts.push(toolName(input.tool, core));
    if (display.showFrame && doc.frames > 1) {
      const tag = tagAt(doc);
      parts.push(tag
        ? t('state.frameTag', { tag: tag.name, frame: doc.frame + 1, total: doc.frames })
        : t('state.frame', { frame: doc.frame + 1, total: doc.frames }));
    }
    if (display.showSelection && input.selection && input.selection.w > 0 && input.selection.h > 0)
      parts.push(t('state.selection', { w: input.selection.w, h: input.selection.h }));
    if (display.showCanvas) parts.push(t('state.canvas', { w: doc.width, h: doc.height }));
    if (display.showDirty && doc.dirty) parts.push(t('state.unsaved'));
    state = parts.length ? parts.join(' · ') : t('state.drawing');
  }

  const activity: DiscordActivity = { type: settings.activityType };

  const detailText = clip(details);
  if (detailText.length >= MIN_TEXT) activity.details = detailText;
  const stateText = clip(state);
  if (stateText.length >= MIN_TEXT) activity.state = stateText;

  if (display.showTimer && input.timing.startedAt > 0 && input.timing.startedAt <= input.timing.now)
    activity.timestamps = { start: Math.round(input.timing.startedAt) };

  const large = settings.largeImage.trim();
  const small = settings.smallImage.trim();
  if (large || small) {
    const assets: DiscordAsset = {};
    if (large) assets.large_image = large;
    if (small) assets.small_image = small;
    const largeText = clip(settings.largeText.trim() || (doc
      ? t('large.summary', { w: doc.width, h: doc.height, layers: doc.layers })
      : t('large.app')));
    if (large && largeText.length >= MIN_TEXT) assets.large_text = largeText;

    const smallText = clip(settings.smallText.trim() || (small === 'pixprite' ? t('large.app') : ''));
    if (small && smallText.length >= MIN_TEXT) assets.small_text = smallText;
    activity.assets = assets;
  }

  if (display.showLink) activity.buttons = [{ label: t('button.site'), url: SITE_URL }];

  return activity.details || activity.state ? activity : null;
}

/**
 * Builds a PresenceDoc from a sprite snapshot and document info.
 * Shared by the worker and the panel preview.
 */
export function buildPresenceDoc(snapshot: SpriteSnapshot | null, doc: DocumentInfo | null, frame: number): PresenceDoc | null {
  if (!snapshot) return null;
  return {
    name: doc?.name || snapshot.name,
    width: snapshot.width,
    height: snapshot.height,
    layers: snapshot.layers.filter(layer => !layer.group).length,
    frames: Math.max(1, snapshot.frames.length),
    tags: snapshot.tags.map(tag => ({ name: tag.name, from: tag.from, to: tag.to })),
    frame: Math.min(frame, Math.max(0, snapshot.frames.length - 1)),
    dirty: !!doc?.dirty,
  };
}

/** What counts as a change for Discord; the elapsed timer alone is not an update */
export function activityKey(activity: DiscordActivity | null): string {
  if (!activity) return '';
  return JSON.stringify({
    type: activity.type,
    details: activity.details,
    state: activity.state,
    assets: activity.assets,
    buttons: activity.buttons,
  });
}

/** Exactly what the bridge forwards, with unknown fields dropped and limits applied */
export function sanitizeActivity(value: unknown): DiscordActivity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const type = [0, 2, 3, 5].includes(raw.type as number) ? raw.type as ActivityType : 0;
  const out: DiscordActivity = { type };
  const field = (name: 'details' | 'state') => {
    const text = typeof raw[name] === 'string' ? clip(raw[name] as string) : '';
    if (text.length >= MIN_TEXT) out[name] = text;
  };
  field('details');
  field('state');
  const timestamps = raw.timestamps;
  if (timestamps && typeof timestamps === 'object') {
    const start = (timestamps as Record<string, unknown>).start;
    if (typeof start === 'number' && Number.isFinite(start) && start > 0) out.timestamps = { start: Math.round(start) };
  }
  const assets = raw.assets;
  if (assets && typeof assets === 'object') {
    const a = assets as Record<string, unknown>;
    const asset = (key: string, max: number) => {
      const text = typeof a[key] === 'string' ? clip(a[key] as string, max) : '';
      return text.length >= MIN_TEXT ? text : '';
    };
    const clean: DiscordAsset = {};
    const large = asset('large_image', 256), small = asset('small_image', 256);
    const largeText = asset('large_text', MAX_TEXT), smallText = asset('small_text', MAX_TEXT);
    if (large) clean.large_image = large;
    if (large && largeText) clean.large_text = largeText;
    if (small) clean.small_image = small;
    if (small && smallText) clean.small_text = smallText;
    if (Object.keys(clean).length) out.assets = clean;
  }
  const buttons = raw.buttons;
  if (Array.isArray(buttons)) {
    const clean = buttons.flatMap(button => {
      if (!button || typeof button !== 'object') return [];
      const b = button as Record<string, unknown>;
      const label = typeof b.label === 'string' ? clip(b.label, 32) : '';
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      if (!label || !/^https?:\/\/\S+$/i.test(url) || url.length > 512) return [];
      return [{ label, url }];
    }).slice(0, 2);
    if (clean.length) out.buttons = clean;
  }
  return out.details || out.state ? out : null;
}
