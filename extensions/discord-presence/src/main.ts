/**
 * Discord presence worker: watches the editor, builds one activity and keeps the local bridge
 * up to date. The bridge is the only part that talks to Discord IPC; see `bridge/bridge.ts`.
 *
 * States handled here: no document, editing, animation playback, selection, idle, unsaved
 * changes, privacy (no file name), disabled, no application id, bridge offline, Discord closed
 * and an application id Discord rejects. Updates are coalesced to one per 15 s.
 */

import { defineExtension, type DocumentInfo, type SpriteSnapshot } from '@pixprite/api';
import { clearPresence, failureState, heartbeat, sendPresence } from './bridge';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, STATUS_KEY, normalizeSettings, validAppId,
  type Settings, type Status,
} from './config';
import {
  activityKey, buildActivity, buildPresenceDoc, type DiscordActivity, type PresenceDoc, type PresenceInput,
} from './presence';

/** Discord allows a handful of updates per 20 s; one per 15 s is comfortably inside */
const PUSH_INTERVAL = 15_000;
const HEARTBEAT_INTERVAL = 30_000;
/** The bridge clears a presence that has not been refreshed for 90 s (extension stopped, tab closed) */
const RETRY = [5_000, 10_000, 20_000, 30_000];
const TICK = 5_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export default defineExtension(async ctx => {
  if (!ctx.editorVersion) throw new Error('Discord presence requires Pixprite 0.0.4 or newer.');

  const { t } = ctx.i18n;
  const tr = (key: string, vars?: Record<string, string | number>) => ctx.i18n.t(key, vars);
  const core = (key: string) => ctx.i18n.core(key);

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let snapshot: SpriteSnapshot | null = null;
  let doc: DocumentInfo | null = null;
  let tool = 'pencil';
  let playing = false;
  let selection: { w: number; h: number } | null = null;
  let frame = 0;
  let startedAt = Date.now();
  let lastActive = Date.now();
  let idle = false;

  /** Activity last accepted by Discord, and when the next update may go */
  let sentKey = '';
  let nextAt = 0;
  let lastBeat = 0;
  let failures = 0;
  /** A clear was already requested for the current disabled/empty state */
  let cleared = true;
  let lastStatus = '';

  let taskQueue: Promise<void> = Promise.resolve();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const enqueue = (work: () => Promise<void>) => {
    taskQueue = taskQueue.then(work, work).catch(error => console.error('[discord-presence]', error));
    return taskQueue;
  };

  async function writeStatus(status: Status) {
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    await ctx.storage.set(STATUS_KEY, status).catch(() => { });
  }

  async function readSettings() {
    const stored = await ctx.storage.get(SETTINGS_KEY).catch(() => undefined);
    settings = normalizeSettings(stored);
  }

  /** Snapshot for name, size, layers, frames, tags and the current frame */
  async function readSprite() {
    snapshot = await ctx.sprite.get().catch(() => null);
    doc = await ctx.documents.active().catch(() => null);
    if (!snapshot) doc = null;
    else frame = snapshot.frame;
    if (!snapshot) selection = null;
  }

  async function readTool() {
    tool = await ctx.state.get('tool').catch(() => 'pencil');
  }

  function input(now: number): PresenceInput {
    return {
      doc: buildPresenceDoc(snapshot, doc, frame),
      tool,
      playing,
      selection,
      idle,
      idleMinutes: settings.idleMinutes,
      timing: { startedAt, now },
    };
  }

  function touch() {
    lastActive = Date.now();
    idle = false;
  }

  /** Re-reads the document. Called from events, debounced so a stroke is one refresh */
  function invalidate(delay = 500) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void enqueue(async () => {
      await readSprite();
      touch();
      await tick();
    }), delay);
  }

  async function clearNow(now: number) {
    const reply = await clearPresence(ctx);
    if (!reply.ok && !reply.offline) console.warn('[discord-presence] clear failed:', reply.message);
    cleared = true;
    sentKey = '';
    nextAt = now + PUSH_INTERVAL;
  }

  async function tick(force = false) {
    const now = Date.now();
    doc = await ctx.documents.active().catch(() => null);
    idle = settings.idleMinutes > 0 && !playing && now - lastActive >= settings.idleMinutes * 60_000;

    if (!settings.enabled) {
      if (!cleared) await clearNow(now);
      await writeStatus({ at: now, state: 'disabled' });
      return;
    }

    if (!validAppId(settings.appId)) {
      if (!cleared) await clearNow(now);
      await writeStatus({ at: now, state: 'missing-app' });
      return;
    }

    const activity = buildActivity(input(now), settings, tr, core);
    const key = activityKey(activity);
    if (!activity) return;

    if (!force && key === sentKey) {
      if (sentKey && now - lastBeat >= HEARTBEAT_INTERVAL) {
        lastBeat = now;
        const reply = await heartbeat(ctx);
        if (!reply.ok) {
          // The bridge (or Discord) went away while the activity is unchanged:
          // write the status the retry loop would, so the panel explains it
          const failed = failureState(reply);
          await writeStatus({ at: now, state: failed.state, message: failed.message });
        } else if (reply.body?.active === false) sentKey = ''; // a restarted bridge forgets the activity
      }
      return;
    }
    if (!force && now < nextAt) return;

    const reply = await sendPresence(ctx, settings.appId, activity);

    if (reply.ok) {
      sentKey = key;
      cleared = false;
      failures = 0;
      nextAt = now + PUSH_INTERVAL;
      lastBeat = now;
      await writeStatus({ at: now, state: 'ok', details: activity.details, stateText: activity.state });
      return;
    }

    const failed = failureState(reply);
    failures = Math.min(failures + 1, RETRY.length);
    nextAt = now + RETRY[failures - 1];
    // The bridge is unreachable or Discord is closed: retry quietly, the panel explains why
    await writeStatus({ at: now, state: failed.state, message: failed.message });
  }

  async function apply(raw: unknown) {
    const wasEnabled = settings.enabled;
    if (isObject(raw)) {
      settings = normalizeSettings(raw);
      await ctx.storage.set(SETTINGS_KEY, settings).catch(() => { });
    } else {
      await readSettings();
    }
    await readSprite();
    await readTool();
    touch();
    sentKey = '';
    cleared = false;
    nextAt = 0;
    lastBeat = 0;
    failures = 0;
    if (settings.enabled && !wasEnabled) startedAt = Date.now();
    await tick(true);
  }

  // Runtime-only commands: the panel pokes the worker through them, no menu entries needed.
  // `settings` is also the declared menu command: with settings it applies them, without it
  // it opens the panel, so the menu stays free of internal entries.
  ctx.commands.register('settings', (raw?: unknown) => isObject(raw)
    ? enqueue(() => apply(raw))
    : ctx.ui.panels.show('settings'));

  // Declared in the manifest, so the user can toggle presence from the menu
  ctx.commands.register('toggle', async () => {
    await readSettings();
    const next = { ...settings, enabled: !settings.enabled };
    await ctx.storage.set(SETTINGS_KEY, next).catch(() => { });
    await apply(next);
    await ctx.ui.notify(t(next.enabled ? 'toggle.on' : 'toggle.off'), 'info');
  });

  // Initial state, then event-driven updates
  await readSettings();
  await readSprite();
  await readTool();
  startedAt = Date.now();
  lastActive = Date.now();
  cleared = !settings.enabled;

  const cleanupFns = [
    ctx.events.on('sprite:change', () => invalidate()),
    ctx.events.on('tags', () => invalidate()),
    ctx.events.on('history', () => { touch(); invalidate(700); }),
    ctx.events.on('tool', event => { tool = event.tool; touch(); invalidate(200); }),
    ctx.events.on('frame', event => { frame = event.frame; touch(); invalidate(300); }),
    ctx.events.on('playback', event => { playing = event.playing; touch(); invalidate(100); }),
    ctx.events.on('selection', event => {
      selection = event.bounds ? { w: event.bounds.w, h: event.bounds.h } : null;
      touch();
      invalidate(200);
    }),
    ctx.documents.on('change', () => {
      startedAt = Date.now();
      selection = null;
      sentKey = '';
      touch();
      invalidate(100);
    }),
    ctx.i18n.on('change', () => { sentKey = ''; invalidate(100); }),
  ];

  // A selection may already exist when the extension is enabled
  void ctx.sprite.selection.get().then(sel => {
    selection = sel.bounds ? { w: sel.bounds.w, h: sel.bounds.h } : null;
  }).catch(() => { });

  // The bridge may answer late; this also keeps the watchdog from clearing an idle presence
  setInterval(() => void enqueue(() => tick()), TICK);

  await enqueue(() => tick(true));

  // No dispose hook in apiVersion 1: stopping the worker stops the timers with it, and the
  // bridge clears the stale presence after 90 s without heartbeats. `cleanupFns` is kept so the
  // subscriptions outlive this async activation.
  void cleanupFns;
});
