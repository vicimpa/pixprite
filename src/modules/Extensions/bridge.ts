/**
 * What the extensions UI needs from the extension host (src/core/extensions/UiHost.ts).
 * The UI never imports the host directly: the host calls `setExtensionsHost` once it starts, so
 * the editor still renders (with an empty store) when extensions are unavailable.
 * Everything the UI shows is read from signals the host owns.
 */

import type { Manifest, PixelData, Problem, RegistryEntryLike } from "./types";
import { signal, type ReadonlySignal } from "@preact/signals-react";

export type { RegistryEntryLike };

export type ExtensionStatus = 'inactive' | 'loading' | 'active' | 'failed';

export type InstalledExtension = {
  manifest: Manifest;
  enabled: boolean;
  status: ExtensionStatus;
  error?: string;
  /** Dev mode: the URL it was loaded from (reloadable) */
  devUrl?: string;
  /** Registry the extension came from, for updates */
  registry?: string;
};

/** Messages the frame sends / receives, already in wire format (see @pixprite/api wire.ts) */
export type FrameLink = {
  /** Called by the host to post to the iframe */
  post(message: unknown, transfer?: Transferable[]): void;
};

export type FrameConnection = {
  /** A message from the iframe */
  receive(message: unknown): void;
  dispose(): void;
};

export interface ExtensionsHost {
  installed: ReadonlySignal<InstalledExtension[]>;
  /** Problems reported by validators, grouped by extension id + validator id */
  problems: ReadonlySignal<{ ext: string; validator: string; problems: Problem[]; }[]>;
  /** Preview of an extension tool's stroke, in sprite coordinates */
  overlay: ReadonlySignal<PixelData | null>;
  /** Last refused structural change (`locked` error), already translated */
  lockedNotice: ReadonlySignal<string | null>;
  /** Locks in the active document whose owner extension is not installed */
  orphanLocks: ReadonlySignal<{ document: string; owner: string; } | null>;

  /** Downloads `entry` from `registryUrl`, checks integrity and stores it; enables it */
  install(entry: RegistryEntryLike, registryUrl: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Loads an unpacked extension from a dev server URL (manifest.json under it) */
  loadDev(url: string): Promise<Manifest>;
  reload(id: string): Promise<void>;
  /** Text of a file inside an installed extension (an html page) */
  readText(id: string, path: string): Promise<string>;
  /** Url (blob or http) of a file inside an installed extension, for icons */
  fileUrl(id: string, path: string): Promise<string>;
  /** Translates `%key%` / plain manifest strings for the current language */
  label(id: string, text: string | undefined): string;
  /** The running instance of `id` (changes when it restarts or updates); read in a render to follow it */
  instance(id: string): object | null;
  /** Attaches an iframe to the RPC bridge as `role` of `id` (sends `init` on load); returns the disconnect */
  connectFrame(id: string, role: 'panel' | 'widget', contribution: string, iframe: HTMLIFrameElement): () => void;
  runCommand(id: string): void;
  runValidators(): Promise<void>;
  /** Removes the orphan locks of the active document */
  unlockOrphan(): void;
}

/** The running host, null until it registers */
export const extensionsHost = signal<ExtensionsHost | null>(null);

export function setExtensionsHost(host: ExtensionsHost | null) {
  extensionsHost.value = host;
}

/** Contributions of enabled, active extensions of one kind, with the owner id */
export function contributions<K extends 'panels' | 'widgets' | 'menus' | 'commands'>(kind: K) {
  const host = extensionsHost.value;
  if (!host) return [];
  return host.installed.value
    .filter(e => e.enabled && e.status !== 'failed')
    .flatMap(e => (e.manifest.contributes?.[kind] ?? []).map(c => ({ ext: e.manifest.id, ...c }) as
      { ext: string; } & NonNullable<NonNullable<Manifest['contributes']>[K]>[number]));
}

/** Css variable names a theme defines; passed into extension iframes */
export const THEME_VARS = [
  '--fg', '--fg-dim', '--bg', '--bg2', '--b1', '--b2', '--face', '--face-hot', '--face-down', '--hilite', '--shade',
  '--accent', '--accent-fg', '--sel', '--sel-fg', '--field', '--menu', '--workspace', '--tooltip', '--tooltip-fg',
  '--danger', '--icon-fill', '--font', '--font-size', '--row', '--gap',
];

/** `:root { --fg: …; }` with the current theme values */
export function themeCss() {
  const cs = getComputedStyle(document.documentElement);
  return `:root{${THEME_VARS.map(v => `${v}:${cs.getPropertyValue(v).trim() || 'initial'}`).join(';')}}`;
}
