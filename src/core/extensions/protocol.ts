/**
 * Host side of the extension protocol: the method list and which permission each one needs.
 * Wire message shapes live in `@pixprite/api` (wire.ts) so both ends share them.
 */
import type { Permission } from "@pixprite/api";

export type {
  ActivatedMessage, CallbackKind, ErrorCode, ErrorInfo, EventMessage, FailedMessage, I18nChange, InitMessage,
  RequestMessage, ResponseMessage, WireMessage,
} from "@pixprite/api";
export { DOCUMENTS_CHANGE, I18N_CHANGE, INVOKE, statePrefix, transferables } from "@pixprite/api";

/**
 * Every method an extension may call, with the permission it needs (null = always allowed).
 * Params are positional, matching the `ExtensionContext` signatures; `sprite.*` requests may carry `tx`.
 * `*.register` take `[id]`, `*.unregister` take `[id]`; the host later calls back with `invoke`.
 */
export const PERMISSION_FOR_METHOD = {
  'sprite.get': 'sprite:read',
  'sprite.getPixels': 'sprite:read',
  'sprite.render': 'sprite:read',
  'sprite.selection.get': 'sprite:read',
  'sprite.putPixels': 'sprite:write',
  'sprite.transaction.begin': 'sprite:write',
  /** `[tx, commit: boolean]` */
  'sprite.transaction.end': 'sprite:write',
  'sprite.layers.add': 'sprite:write',
  'sprite.layers.remove': 'sprite:write',
  'sprite.layers.update': 'sprite:write',
  'sprite.layers.move': 'sprite:write',
  'sprite.frames.add': 'sprite:write',
  'sprite.frames.remove': 'sprite:write',
  'sprite.frames.setDuration': 'sprite:write',
  'sprite.frames.move': 'sprite:write',
  'sprite.tags.add': 'sprite:write',
  'sprite.tags.remove': 'sprite:write',
  'sprite.tags.update': 'sprite:write',
  'sprite.slices.add': 'sprite:write',
  'sprite.slices.remove': 'sprite:write',
  'sprite.slices.update': 'sprite:write',
  'sprite.selection.set': 'sprite:write',

  'documents.list': 'sprite:read',
  'documents.active': 'sprite:read',
  'documents.open': 'sprite:write',
  'documents.create': 'sprite:write',

  /** `[eventName]`; sprite events need `sprite:read` — checked by the host per event */
  'events.subscribe': null,
  'events.unsubscribe': null,

  'commands.register': null,
  'commands.unregister': null,
  'commands.run': null,
  'commands.list': null,

  'tools.register': 'sprite:write',
  'tools.unregister': null,
  'tools.overlay': null,

  'filters.register': 'sprite:write',
  'filters.unregister': null,

  'io.registerImporter': 'sprite:write',
  'io.registerExporter': 'sprite:read',
  'io.unregister': null,

  'ui.notify': null,
  'ui.confirm': null,
  'ui.prompt': null,
  'ui.pickColor': null,
  'ui.pickFile': null,
  /** Returns a progress id; `update` takes `[id, 0..1]`, `done` takes `[id]` */
  'ui.progress': null,
  'ui.progress.update': null,
  'ui.progress.done': null,
  /** `[title, FormSchema]` */
  'ui.showForm': null,
  /** `[panel id]`, one of the extension's own panels */
  'ui.panels.show': 'ui:panel',
  'ui.panels.hide': 'ui:panel',

  'view.zoom': null,
  'view.setZoom': null,
  'view.pan': null,
  'view.setPan': null,
  'view.toScreen': null,
  'view.toSprite': null,

  'state.get': null,
  'state.set': null,

  'playback.play': null,
  'playback.stop': null,
  'playback.seek': null,

  'meta.get': 'sprite:read',
  'meta.set': 'sprite:write',
  'meta.delete': 'sprite:write',

  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.delete': 'storage',
  'storage.keys': 'storage',

  'locks.get': null,
  'locks.set': 'tags:lock',
  'locks.clear': 'tags:lock',

  'validators.register': 'sprite:read',
  'validators.unregister': null,

  /** `[id]` → `{ id, version, exports: string[] } | null` */
  'extensions.get': null,
  /** `[id, method, args[]]` */
  'extensions.call': null,

  /** Host must also match the url host against `network:<host>` */
  'net.fetch': 'network',

  'clipboard.read': 'clipboard',
  'clipboard.write': 'clipboard',
} as const satisfies Record<string, Permission | 'network' | null>;

export type Method = keyof typeof PERMISSION_FOR_METHOD;

export const METHODS = Object.keys(PERMISSION_FOR_METHOD) as Method[];

export const isMethod = (m: string): m is Method => Object.hasOwn(PERMISSION_FOR_METHOD, m);

/** Methods only an iframe with `ui:panel` should get; workers are not restricted by role */
export const PANEL_PERMISSION: Permission = 'ui:panel';

/** Events that reveal document content and so need `sprite:read` */
export const SPRITE_EVENTS = new Set(['sprite:change', 'selection', 'tags', 'history', 'documents:change']);

/**
 * Whether `permissions` allow `method` (for `net.fetch` pass the target `url`).
 * Returns the missing permission, or null when allowed.
 */
export function missingPermission(method: string, permissions: readonly string[], url?: string): string | null {
  if (!isMethod(method)) return method;
  const need = PERMISSION_FOR_METHOD[method];
  if (need === null) return null;
  if (need === 'network') {
    let host = '';
    try { host = new URL(url ?? '').host; } catch { return 'network:<invalid url>'; }
    return permissions.includes(`network:${host}`) || permissions.includes('network:*') ? null : `network:${host}`;
  }
  return permissions.includes(need) ? null : need;
}
