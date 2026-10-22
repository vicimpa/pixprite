/**
 * Wire format between the host (editor) and an extension (worker or iframe panel).
 * Every message is a plain object with a `type`; ArrayBuffers inside params/results are transferred.
 *
 * Flow:
 *   host → ext   `init`        (ids, language, translated strings)
 *   ext  → host  `activated` | `failed`
 *   ext  → host  `request`     ctx API call; host answers with `response`
 *   host → ext   `request`     method `invoke`: calls a callback the extension registered
 *   host → ext   `event`       subscribed event (see `events.subscribe`)
 */

export type InitMessage = {
  type: 'init';
  id: string;
  version: string;
  apiVersion: number;
  /** `worker` for the entry, `panel` / `widget` for iframes (with the contribution id) */
  role: 'worker' | 'panel' | 'widget';
  contribution?: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  /** The extension's own strings for `lang` with fallbacks applied, keys without `ext.<id>.` */
  strings: Record<string, string>;
  /** Core dictionary for `lang` with fallbacks applied */
  core: Record<string, string>;
};

export type ActivatedMessage = {
  type: 'activated';
  /** Names of the functions `activate` returned (inter-extension api) */
  exports: string[];
};

export type FailedMessage = { type: 'failed'; error: string; };

/** Something the extension printed or threw; the editor shows it and forwards it to a dev server */
export type LogMessage = { type: 'log'; level: 'error' | 'warn' | 'info'; message: string; stack?: string; };

export type RequestMessage = {
  type: 'request';
  id: number;
  method: string;
  /** Positional arguments */
  params: unknown[];
  /** Transaction the call belongs to (from `sprite.transaction.begin`) */
  tx?: number;
};

export type ErrorInfo = { message: string; code?: ErrorCode; };

export type ResponseMessage =
  | { type: 'response'; id: number; result: unknown; }
  | { type: 'response'; id: number; error: ErrorInfo; };

export type EventMessage = { type: 'event'; event: string; data: unknown; };

export type WireMessage = InitMessage | ActivatedMessage | FailedMessage | LogMessage | RequestMessage | ResponseMessage | EventMessage;

export type ErrorCode = 'permission' | 'not-found' | 'locked' | 'invalid' | 'no-document' | 'cancelled' | 'internal';

/**
 * Callback kinds the host can `invoke` on the extension: params are `[kind, id, ...args]`.
 * `tool` args are `[phase: 'down'|'move'|'up'|'cancel', pointer?]`.
 * `export` args are `[method, ...args]` (inter-extension call).
 */
export type CallbackKind = 'command' | 'tool' | 'filter' | 'importer' | 'exporter' | 'validator' | 'export';

/** Method name of the host → extension callback request */
export const INVOKE = 'invoke';

/**
 * Event names pushed by the host. Besides `EventMap` keys:
 * `documents:change`, `state:<key>`, `i18n:change` ({ lang, dir, strings, core }).
 */
export const I18N_CHANGE = 'i18n:change';
export const DOCUMENTS_CHANGE = 'documents:change';
export const statePrefix = 'state:';

export type I18nChange = Pick<InitMessage, 'lang' | 'dir' | 'strings' | 'core'>;

/** Collects ArrayBuffers in a value so they can be transferred */
export function transferables(value: unknown, out: Transferable[] = [], seen = new Set<unknown>()): Transferable[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof ArrayBuffer) out.push(value);
  else if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer && !seen.has(value.buffer)) { seen.add(value.buffer); out.push(value.buffer); } }
  else if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) out.push(value);
  else if (Array.isArray(value)) for (const v of value) transferables(v, out, seen);
  else if (Object.getPrototypeOf(value) === Object.prototype) for (const v of Object.values(value)) transferables(v, out, seen);
  return out;
}
