/** Plain data crossing the native bridge. No Node APIs reach the editor. */
import type { UpdateAction, UpdateState } from './update-types';
export type AutomationRequest = { method: string; params?: Record<string, unknown> };
export type AutomationReply = { id: string; result?: unknown; error?: string };
export type DesktopFile = { name: string; data: string };
export type WindowSession = { tabs: string[]; active: string | null };
export type WindowState = { maximized: boolean; fullscreen: boolean; focused: boolean };
export type WindowAction = 'minimize' | 'maximize' | 'fullscreen' | 'close';
export type DesktopBridge = {
  runtime?: 'tauri';
  library?(request: Uint8Array): Promise<any>;
  saveDownload?(name: string, blob: Blob): Promise<void>;
  copyImage?(bitmap: { w: number; h: number; data: Uint32Array }): Promise<void>;
  pasteImage?(): Promise<{ w: number; h: number; data: Uint32Array } | null>;
  windowId: 'main';
  platform: string;
  /** Read-only migration of working copies from older multi-window profiles. */
  recoveryWindows: string[];
  recoveredWindows(ids: string[]): void;
  reportSession(session: WindowSession): Promise<void>;
  readSessions(): Promise<Record<string, WindowSession | undefined>>;
  windowState(): Promise<WindowState>;
  onWindowState(handler: (state: WindowState) => void): () => void;
  controlWindow(action: WindowAction): Promise<void>;
  onRequest(handler: (request: AutomationRequest) => Promise<unknown>): void;
  onFiles(handler: (files: DesktopFile[]) => Promise<void>): void;
  ready(): void;
  getUpdate(): Promise<UpdateState>;
  onUpdate(handler: (state: UpdateState) => void): () => void;
  update(action: UpdateAction): Promise<void>;
  setLanguage(language: string): void;
};

export const editMethods = [
  'sprite.layers.add', 'sprite.layers.remove', 'sprite.layers.update', 'sprite.layers.move',
  'sprite.frames.add', 'sprite.frames.remove', 'sprite.frames.setDuration', 'sprite.frames.move',
  'sprite.tags.add', 'sprite.tags.remove', 'sprite.tags.update',
  'sprite.slices.add', 'sprite.slices.remove', 'sprite.slices.update',
  'sprite.palette.set', 'sprite.selection.set',
] as const;

declare global { interface Window { pixpriteDesktop?: DesktopBridge } }
