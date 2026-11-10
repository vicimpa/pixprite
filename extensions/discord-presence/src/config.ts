/**
 * Settings and shared constants of the Discord presence extension.
 *
 * Discord Rich Presence has no HTTP API: the editor talks to a small local bridge
 * (`bridge/bridge.ts`), which owns the Discord IPC socket. Both sides agree on the
 * port below; the manifest allowlists exactly that host and port.
 */

/** Port of the local bridge; also the `network:` permission in manifest.json */
export const BRIDGE_PORT = 52700;
export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

/** Where the "Pixprite" button points (Discord shows at most two buttons) */
export const SITE_URL = 'https://vicimpa.github.io/pixprite/';

/** Discord activity types: playing, listening, watching, competing */
export type ActivityType = 0 | 2 | 3 | 5;
export const ACTIVITY_TYPES: readonly ActivityType[] = [0, 2, 3, 5];

export type DisplayOptions = {
  showFile: boolean;
  showCanvas: boolean;
  showTool: boolean;
  showFrame: boolean;
  showSelection: boolean;
  showDirty: boolean;
  showTimer: boolean;
  showLink: boolean;
};

export type Settings = {
  version: 1;
  enabled: boolean;
  /** Discord application id (snowflake); the application's name is what Discord shows */
  appId: string;
  activityType: ActivityType;
  display: DisplayOptions;
  /** Minutes without edits before the state says "Idle"; 0 never */
  idleMinutes: number;
  /** Rich Presence asset key, or '' to hide the image */
  largeImage: string;
  /** Tooltip of the large image; empty falls back to the canvas summary */
  largeText: string;
  smallImage: string;
  smallText: string;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  appId: '',
  activityType: 0,
  display: {
    showFile: true,
    showCanvas: true,
    showTool: true,
    showFrame: true,
    showSelection: true,
    showDirty: true,
    showTimer: true,
    showLink: false,
  },
  idleMinutes: 5,
  largeImage: 'pixprite',
  largeText: '',
  smallImage: '',
  smallText: '',
};

export const SETTINGS_KEY = 'settings';
export const STATUS_KEY = 'status';

export const APP_ID = /^\d{15,21}$/;
export const validAppId = (value: string) => APP_ID.test(value.trim());

/** Why no activity is visible right now, for the panel */
export type StatusState = 'ok' | 'disabled' | 'missing-app' | 'offline' | 'discord-closed' | 'bad-app' | 'error';
export type Status = {
  /** When the worker last wrote this status */
  at: number;
  state: StatusState;
  /** Raw bridge/Discord message, if any */
  message?: string;
  /** Activity lines last accepted by Discord, for the panel */
  details?: string;
  stateText?: string;
};

const text = (value: unknown, fallback: string, max = 256) => {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean ? clean.slice(0, max) : fallback;
};

/** Unknown or older settings objects become complete, valid settings */
export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const topBool = (key: keyof Settings, fallback: boolean) =>
    typeof raw[key] === 'boolean' ? raw[key] as boolean : fallback;
  const asset = (key: keyof Settings, fallback: string) =>
    typeof raw[key] === 'string' ? text(raw[key], fallback, 64) : fallback;
  const type = ACTIVITY_TYPES.includes(raw.activityType as ActivityType)
    ? raw.activityType as ActivityType
    : DEFAULT_SETTINGS.activityType;
  const idle = typeof raw.idleMinutes === 'number' && Number.isFinite(raw.idleMinutes)
    ? Math.min(240, Math.max(0, Math.round(raw.idleMinutes)))
    : DEFAULT_SETTINGS.idleMinutes;
  // Handle legacy flat structure
  const displayRaw = raw.display && typeof raw.display === 'object' ? raw.display as Record<string, unknown> : raw;
  const displayBool = (key: keyof DisplayOptions, fallback: boolean) =>
    typeof displayRaw[key] === 'boolean' ? displayRaw[key] as boolean : fallback;
  return {
    version: 1,
    enabled: topBool('enabled', DEFAULT_SETTINGS.enabled),
    // An id never gets a fallback: a wrong one makes Discord reject the handshake
    appId: typeof raw.appId === 'string' ? raw.appId.replace(/\D+/g, '').slice(0, 21) : DEFAULT_SETTINGS.appId,
    activityType: type,
    display: {
      showFile: displayBool('showFile', DEFAULT_SETTINGS.display.showFile),
      showCanvas: displayBool('showCanvas', DEFAULT_SETTINGS.display.showCanvas),
      showTool: displayBool('showTool', DEFAULT_SETTINGS.display.showTool),
      showFrame: displayBool('showFrame', DEFAULT_SETTINGS.display.showFrame),
      showSelection: displayBool('showSelection', DEFAULT_SETTINGS.display.showSelection),
      showDirty: displayBool('showDirty', DEFAULT_SETTINGS.display.showDirty),
      showTimer: displayBool('showTimer', DEFAULT_SETTINGS.display.showTimer),
      showLink: displayBool('showLink', DEFAULT_SETTINGS.display.showLink),
    },
    idleMinutes: idle,
    largeImage: asset('largeImage', DEFAULT_SETTINGS.largeImage),
    largeText: asset('largeText', DEFAULT_SETTINGS.largeText),
    smallImage: asset('smallImage', DEFAULT_SETTINGS.smallImage),
    smallText: asset('smallText', DEFAULT_SETTINGS.smallText),
  };
}
