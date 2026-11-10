/**
 * Settings panel of the Discord presence extension. Everything is stored in `ctx.storage`
 * and pushed to the worker through its `apply` command, so changes apply at once.
 * The card at the top is a live preview of the activity Discord will show.
 */

import type { DocumentInfo, SpriteSnapshot } from '@pixprite/api';
import { Button, Check, Input, Muted, Select, type ExtensionPageProps } from '@pixprite/ui-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { bridgeStatus, failureState, sendPresence } from './bridge';
import {
  ACTIVITY_TYPES, BRIDGE_URL, DEFAULT_SETTINGS, SETTINGS_KEY, STATUS_KEY, normalizeSettings, validAppId,
  type ActivityType, type Settings, type Status,
} from './config';
import { drawIcon } from './icon';
import {
  buildActivity, buildPresenceDoc, type DiscordActivity, type PresenceDoc, type PresenceInput,
} from './presence';

const enumText = (value: boolean, t: (key: string) => string) => value ? t('meta.on') : t('meta.off');

export default function Panel({ ctx }: ExtensionPageProps) {
  const { t } = ctx.i18n;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [input, setInput] = useState<PresenceInput | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lang, setLang] = useState(ctx.i18n.lang);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Settings | null>(null);
  const repaint = useRef<() => void>(() => { });
  const icon = (node: HTMLCanvasElement | null) => { if (node) drawIcon(node, 128); };
  const smallIcon = (node: HTMLCanvasElement | null) => { if (node) drawIcon(node, 64); };

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Load settings once
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await ctx.storage.get(SETTINGS_KEY).catch(() => undefined);
      if (!alive) return;
      const next = normalizeSettings(stored);
      settingsRef.current = next;
      setSettings(next);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [ctx]);

  // The worker reports through storage; poll while the panel is open
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const next = await ctx.storage.get<Status>(STATUS_KEY).catch(() => undefined);
      if (alive) setStatus(next ?? null);
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [ctx]);

  // Follow the document for the preview
  useEffect(() => {
    let alive = true;
    let later: ReturnType<typeof setTimeout> | undefined;
    const state = {
      snapshot: null as SpriteSnapshot | null,
      doc: null as DocumentInfo | null,
      tool: 'pencil',
      playing: false,
      selection: null as { w: number; h: number } | null,
      frame: 0,
      lastActive: Date.now(),
      startedAt: Date.now(),
    };

    const update = () => {
      if (!alive) return;
      const current = settingsRef.current;
      const now = Date.now();
      const idle = current.idleMinutes > 0 && !state.playing && now - state.lastActive >= current.idleMinutes * 60_000;
      const sprite = state.snapshot;
      const doc = buildPresenceDoc(sprite, state.doc, state.frame);
      setInput({
        doc, tool: state.tool, playing: state.playing, selection: state.selection,
        idle, idleMinutes: current.idleMinutes, timing: { startedAt: state.startedAt, now },
      });
    };
    repaint.current = update;

    const refresh = async () => {
      const [snapshot, doc, tool] = await Promise.all([
        ctx.sprite.get().catch(() => null),
        ctx.documents.active().catch(() => null),
        ctx.state.get('tool').catch(() => 'pencil'),
      ]);
      if (!alive) return;
      state.snapshot = snapshot;
      state.doc = snapshot ? doc : null;
      state.tool = tool;
      if (snapshot) state.frame = snapshot.frame;
      update();
    };
    const soon = () => { clearTimeout(later); later = setTimeout(update, 150); };

    const off = [
      ctx.events.on('sprite:change', () => { state.lastActive = Date.now(); void refresh(); }),
      ctx.events.on('tags', () => void refresh()),
      ctx.events.on('history', () => { state.lastActive = Date.now(); soon(); }),
      ctx.events.on('tool', event => { state.tool = event.tool; state.lastActive = Date.now(); soon(); }),
      ctx.events.on('frame', event => { state.frame = event.frame; state.lastActive = Date.now(); soon(); }),
      ctx.events.on('playback', event => { state.playing = event.playing; state.lastActive = Date.now(); soon(); }),
      ctx.events.on('selection', event => {
        state.selection = event.bounds ? { w: event.bounds.w, h: event.bounds.h } : null;
        state.lastActive = Date.now();
        soon();
      }),
      ctx.documents.on('change', () => { state.startedAt = Date.now(); state.selection = null; void refresh(); }),
      ctx.i18n.on('change', value => { setLang(value); soon(); }),
    ];

    void refresh();
    const timer = setInterval(update, 5000);
    return () => {
      alive = false;
      clearTimeout(later);
      clearInterval(timer);
      off.forEach(fn => fn());
    };
  }, [ctx]);

  useEffect(() => { repaint.current(); }, [settings]);

  const tr = useMemo(() => (key: string, vars?: Record<string, string | number>) => ctx.i18n.t(key, vars), [ctx]);
  const core = useMemo(() => (key: string) => ctx.i18n.core(key), [ctx]);
  const activity = useMemo(
    () => input ? buildActivity(input, settings, tr, core) : null,
    // `lang` and `settings` both change the texts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, settings, lang],
  );

  const store = (next: Settings) => {
    pending.current = next;
    clearTimeout(saveTimer.current);
    const flush = async () => {
      const value = pending.current;
      if (!value) return;
      pending.current = null;
      await ctx.storage.set(SETTINGS_KEY, value).catch(() => { });
      await ctx.commands.run(`${ctx.id}:settings`, value).catch(() => { });
    };
    saveTimer.current = setTimeout(() => void flush(), 300);
  };

  // Applying on close keeps the last click even when the panel is hidden at once
  useEffect(() => () => {
    const value = pending.current;
    if (!value) return;
    void ctx.storage.set(SETTINGS_KEY, value).catch(() => { });
    void ctx.commands.run(`${ctx.id}:settings`, value).catch(() => { });
  }, [ctx]);

  const update = (patch: Partial<Settings>, immediate = false) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (immediate) {
      pending.current = next;
      clearTimeout(saveTimer.current);
      const value = next;
      void ctx.storage.set(SETTINGS_KEY, value).catch(() => { });
      void ctx.commands.run(`${ctx.id}:settings`, value).catch(() => { });
    } else store(next);
  };

  const checkBridge = async () => {
    setChecking(true);
    setProbe(null);
    const reply = await bridgeStatus(ctx);
    setChecking(false);
    if (!reply.ok) {
      setProbe({ ok: false, text: reply.offline ? t('probe.offline') : t('probe.error', { message: reply.message ?? '' }) });
      return;
    }
    setProbe({ ok: !!reply.body?.discord, text: reply.body?.discord ? t('probe.connected') : t('probe.bridgeOnly') });
  };

  const testNow = async () => {
    if (!validAppId(settings.appId)) {
      setTest({ ok: false, text: t('appIdInvalid') });
      return;
    }
    if (!activity) return;
    setTesting(true);
    setTest(null);
    const reply = await sendPresence(ctx, settings.appId, activity);
    setTesting(false);
    if (reply.ok) setTest({ ok: true, text: t('testOk') });
    else {
      const failed = failureState(reply);
      setTest({ ok: false, text: t('testFail', {
        error: failed.state === 'offline' ? t('probe.offline')
          : failed.state === 'discord-closed' ? t('status.discordClosed')
            : failed.message ?? reply.message ?? '',
      }) });
    }
  };

  const state = statusView(status, t);
  const verb = activityVerb(settings.activityType, t);
  const appIdBad = settings.appId.length > 0 && !validAppId(settings.appId);
  const started = input ? Math.max(0, Math.floor((input.timing.now - input.timing.startedAt) / 1000)) : 0;

  return <>
    <style>{css}</style>
    <div id="discord-presence">
      <div className={`status ${state.tone}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        <div className="statusText">
          <strong>{state.title}</strong>
          {state.detail && <Muted>{state.detail}</Muted>}
        </div>
        <Button type="button" onClick={() => void checkBridge()} disabled={checking}>{checking ? t('probe.checking') : t('status.check')}</Button>
      </div>
      {probe && <div className={probe.ok ? 'note good' : 'note bad'}>{probe.text}</div>}

      <label className="toggle">
        <Check checked={settings.enabled} onChange={event => update({ enabled: event.currentTarget.checked }, true)} />
        <span>{t('panel.enabled')}</span>
      </label>

      <section>
        <h2>{t('panel.application')}</h2>
        <div className="row">
          <span>{t('panel.appId')}</span>
          <Input value={settings.appId} inputMode="numeric" autoComplete="off" spellCheck={false}
            aria-label={t('panel.appId')} aria-invalid={appIdBad}
            onInput={event => update({ appId: event.currentTarget.value.replace(/\D+/g, '').slice(0, 21) })} />
        </div>
        {appIdBad && <div className="note bad">{t('appIdInvalid')}</div>}
        {!settings.appId && <div className="note">{t('panel.appIdRequired')}</div>}
        <details open={!settings.appId}>
          <summary>{t('panel.setup')}</summary>
          <div className="body">
            <ol>
              <li>{t('panel.step1')}<code>discord.com/developers/applications</code></li>
              <li>{t('panel.step2')}</li>
              <li>{t('panel.step3')}<code>bun extensions/discord-presence/bridge/bridge.ts</code></li>
              <li>{t('panel.step4')}</li>
            </ol>
            <Muted>{t('panel.stepNote')}</Muted>
            <div className="bridgeUrl"><Muted>{t('panel.bridgeUrl')}</Muted> <code>{BRIDGE_URL}</code></div>
          </div>
        </details>
      </section>

      <section>
        <h2>{t('panel.display')}</h2>
        <div className="checks">
          {([
            ['showFile', 'panel.showFile'],
            ['showCanvas', 'panel.showCanvas'],
            ['showTool', 'panel.showTool'],
            ['showFrame', 'panel.showFrame'],
            ['showSelection', 'panel.showSelection'],
            ['showDirty', 'panel.showDirty'],
            ['showTimer', 'panel.showTimer'],
            ['showLink', 'panel.showLink'],
          ] as const).map(([key, label]) => <label className="check" key={key}>
            <Check checked={settings.display[key]} onChange={event => update({ display: { ...settings.display, [key]: event.currentTarget.checked } })} />
            <span>{t(label)}</span>
          </label>)}
        </div>
        {settings.display.showLink && <Muted style={{ display: 'block', marginTop: '-2px', paddingLeft: '22px' }}>{t('panel.showLinkNote')}</Muted>}
        <div className="row">
          <span>{t('panel.idle')}</span>
          <Input type="number" min={0} max={240} step={1} value={settings.idleMinutes}
            aria-label={t('panel.idle')}
            onInput={event => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) update({ idleMinutes: Math.min(240, Math.max(0, Math.round(value))) });
            }} />
          <Muted>{t('panel.minutes')}</Muted>
        </div>
        <div className="row">
          <span>{t('panel.type')}</span>
          <Select value={settings.activityType} aria-label={t('panel.type')}
            onChange={event => update({ activityType: Number(event.target.value) as ActivityType }, true)}>
            {ACTIVITY_TYPES.map(type => <option key={type} value={type}>{activityVerb(type, t)}</option>)}
          </Select>
        </div>
      </section>

      <details>
        <summary>{t('panel.advanced')}</summary>
        <div className="body">
          <Muted>{t('panel.assetHint')}</Muted>
          <div className="row"><span>{t('panel.largeImage')}</span>
            <Input value={settings.largeImage} aria-label={t('panel.largeImage')}
              onInput={event => update({ largeImage: event.currentTarget.value.trim() })} /></div>
          <div className="row"><span>{t('panel.largeText')}</span>
            <Input value={settings.largeText} aria-label={t('panel.largeText')}
              onInput={event => update({ largeText: event.currentTarget.value })} /></div>
          <div className="row"><span>{t('panel.smallImage')}</span>
            <Input value={settings.smallImage} aria-label={t('panel.smallImage')}
              onInput={event => update({ smallImage: event.currentTarget.value.trim() })} /></div>
          <div className="row"><span>{t('panel.smallText')}</span>
            <Input value={settings.smallText} aria-label={t('panel.smallText')}
              onInput={event => update({ smallText: event.currentTarget.value })} /></div>
        </div>
      </details>

      <div className="actions">
        <Button type="button" onClick={() => void testNow()} disabled={testing || !loaded}>
          {testing ? t('panel.testing') : t('panel.test')}
        </Button>
        <Button type="button" onClick={() => update({ enabled: false }, true)} disabled={!settings.enabled}>
          {t('panel.stop')}
        </Button>
      </div>
      {test && <div className={test.ok ? 'note good' : 'note bad'}>{test.text}</div>}

      <section>
        <h2>{t('panel.preview')}</h2>
        <div className="discord">
          <div className="discordHead">
            <span className="verb">{verb} <b>{t('preview.app')}</b></span>
            <span className="dots" aria-hidden="true">…</span>
          </div>
          <div className="discordBody">
            <div className="art" title={activity?.assets?.large_text}>
              {settings.largeImage && <canvas ref={icon} width={64} height={64} aria-label={t('preview.app')} />}
              {settings.smallImage && <div className="smallArt" title={activity?.assets?.small_text}>
                {settings.smallImage === 'pixprite' ? <canvas ref={smallIcon} width={32} height={32} /> : <div className="assetPlaceholder" />}
              </div>}
              <span className="presenceDot" aria-hidden="true" />
            </div>
            <div className="lines">
              <strong className="appName">{t('preview.app')}</strong>
              <div className="details">{activity?.details ?? t('preview.nothing')}</div>
              <div className="activityState">{activity?.state ?? ''}</div>
              {settings.display.showTimer && <div className="elapsed">{clock(started)}</div>}
            </div>
          </div>
          {activity?.buttons?.length ? <div className="discordButtons">
            {activity.buttons.map(button => <span className="discordButton" key={button.url}>{button.label}</span>)}
          </div> : null}
        </div>
        <Muted>{t('preview.note')}</Muted>
        <div className="iconHint">
          <canvas ref={node => { if (node) drawIcon(node, 512); }} width={512} height={512} aria-label={t('preview.icon')} />
          <Muted>{t('preview.iconHint')}</Muted>
        </div>
      </section>

      <div className="stateDebug">
        <Muted>{t('preview.meta', {
          on: enumText(settings.enabled, t),
          idle: settings.idleMinutes ? `${settings.idleMinutes} min` : t('panel.never'),
          type: activityVerb(settings.activityType, t),
        })}</Muted>
      </div>
    </div>
  </>;
}

/** Short status card model, shared by the markup above */
function statusView(status: Status | null, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (!status) return { tone: 'idle', title: t('status.unknown'), detail: t('status.unknownDetail') };
  const ago = relative(status.at, t);
  switch (status.state) {
    case 'ok':
      return { tone: 'good', title: t('status.ok'), detail: [status.details, status.stateText].filter(Boolean).join(' · ') || t('status.okDetail', { ago }) };
    case 'disabled':
      return { tone: 'idle', title: t('status.disabled'), detail: t('status.disabledDetail') };
    case 'missing-app':
      return { tone: 'warn', title: t('status.missingApp'), detail: t('status.missingAppDetail') };
    case 'offline':
      return { tone: 'bad', title: t('status.offline'), detail: t('status.offlineDetail') };
    case 'discord-closed':
      return { tone: 'bad', title: t('status.discordClosed'), detail: t('status.discordClosedDetail') };
    case 'bad-app':
      return { tone: 'bad', title: t('status.badApp'), detail: t('status.badAppDetail') };
    default:
      return { tone: 'bad', title: t('status.error'), detail: status.message || t('status.errorDetail', { ago }) };
  }
}

function relative(at: number, t: (key: string, vars?: Record<string, string | number>) => string) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 5) return t('ago.now');
  if (seconds < 60) return t('ago.seconds', { count: seconds });
  if (seconds < 3600) return t('ago.minutes', { count: Math.floor(seconds / 60) });
  return t('ago.hours', { count: Math.floor(seconds / 3600) });
}

function activityVerb(type: ActivityType, t: (key: string) => string) {
  return t(`type.${type}`);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const css = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: var(--font-size, 12px) var(--font, sans-serif); }
#discord-presence { display: flex; flex-direction: column; gap: 8px; padding: 6px; min-width: 0; }
h2 { margin: 0 0 4px; font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--accent); }
section { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
details { border: 1px solid var(--b2); background: var(--bg2); min-width: 0; }
summary { padding: 3px 6px; cursor: pointer; color: var(--accent); user-select: none; }
.body { padding: 4px 6px 6px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.body ol { margin: 0; padding-inline-start: 18px; display: flex; flex-direction: column; gap: 4px; line-height: 1.35; }
.body code, .bridgeUrl code { display: block; margin-top: 2px; padding: 2px 4px; background: var(--field); color: var(--fg); white-space: pre-wrap; word-break: break-all; }
.row { display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; min-height: 20px; }
.row > span:first-child { flex: 1 1 9em; min-width: 0; color: var(--fg-dim); }
.row > px-input { flex: 1 1 10em; min-width: 0; }
.row input[type=number] { width: 64px; }
.toggle { display: flex; align-items: center; gap: 6px; padding: 5px 6px; background: var(--bg2); border: 1px solid var(--b2); cursor: pointer; }
.checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 2px 8px; }
.check { display: flex; align-items: center; gap: 5px; cursor: pointer; min-width: 0; }
.check span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { display: flex; align-items: center; gap: 7px; padding: 6px; background: var(--bg2); border: 1px solid var(--b2); }
.status .dot { width: 8px; height: 8px; flex: 0 0 auto; background: var(--fg-dim); box-shadow: 0 0 0 1px var(--shade); }
.status.good .dot { background: #4cd964; }
.status.warn .dot { background: #f0b24a; }
.status.bad .dot { background: var(--danger); }
.statusText { flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.statusText strong { font-weight: 500; }
.statusText span { white-space: normal; line-height: 1.3; }
.status > px-button { flex: 0 0 auto; }
.note { line-height: 1.35; white-space: normal; }
.note.good { color: var(--accent); }
.note.bad { color: var(--danger); }
.actions { display: flex; gap: 6px; }
.actions > px-button { flex: 1 1 0; display: flex; }
.actions button { flex: 1; white-space: normal; height: auto; min-height: var(--row, 24px); }
.discord { background: #1e1f22; color: #f2f3f5; border: 1px solid #111214; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.discordHead { display: flex; align-items: center; justify-content: space-between; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #b5bac1; }
.discordHead b { color: #f2f3f5; font-weight: 600; }
.dots { letter-spacing: 1px; }
.discordBody { display: flex; gap: 10px; align-items: flex-start; }
.art { position: relative; flex: 0 0 auto; width: 56px; height: 56px; background: #111214; display: grid; place-items: center; }
.art canvas { width: 48px; height: 48px; image-rendering: pixelated; }
.smallArt { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; background: #1e1f22; border-radius: 50%; display: grid; place-items: center; }
.smallArt canvas { width: 18px; height: 18px; image-rendering: pixelated; border-radius: 50%; }
.assetPlaceholder { width: 18px; height: 18px; background: #313338; border-radius: 50%; border: 1px dashed #b5bac1; }
.presenceDot { position: absolute; right: -3px; bottom: -3px; width: 14px; height: 14px; border-radius: 50%; background: #4cd964; border: 3px solid #1e1f22; }
.presenceDot { display: none; } /* Hide status dot in art if small icon is present to match Discord behavior */
.art:not(:has(.smallArt)) .presenceDot { display: block; }
.lines { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.appName { font-size: 13px; font-weight: 600; }
.details { color: #f2f3f5; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activityState { color: #b5bac1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elapsed { color: #b5bac1; font-variant-numeric: tabular-nums; }
.discordButtons { display: flex; flex-direction: column; gap: 3px; }
.discordButton { display: block; padding: 4px 6px; text-align: center; background: #313338; color: #f2f3f5; font-weight: 500; }
.iconHint { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.iconHint canvas { width: 64px; height: 64px; image-rendering: pixelated; flex: 0 0 auto; background: #111214; }
.iconHint span { flex: 1 1 auto; }
.stateDebug { color: var(--fg-dim); }
@media (max-width: 380px) { .checks { grid-template-columns: 1fr; } .actions { flex-direction: column; } }
`;
