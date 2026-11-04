/** Plain data crossing the native bridge. No Node APIs reach the editor. */
import type { UpdateAction, UpdateState } from './update-types';
export type AutomationRequest = { method: string; params?: Record<string, unknown> };
export type AutomationReply = { id: string; result?: unknown; error?: string };
export type DesktopFile = { name: string; data: string };
export type WindowSession = { tabs: string[]; active: string | null };
export type WindowState = { maximized: boolean; fullscreen: boolean; focused: boolean };
export type WindowAction = 'minimize' | 'maximize' | 'fullscreen' | 'close';
export type McpState = {
  enabled: boolean;
  forced: boolean;
  blocked: boolean;
  running: boolean;
  url: string | null;
  token: string | null;
  port: number;
  activePort: number | null;
  serverPid: number | null;
  connectionFile: string;
  error: string | null;
};
export type DesktopBridge = {
  runtime?: 'tauri';
  library?(request: Uint8Array): Promise<any>;
  /** false when the user cancels; true only after the native file is written. */
  saveDownload?(name: string, blob: Blob, protectExisting?: boolean): Promise<boolean>;
  copyImage?(bitmap: { w: number; h: number; data: Uint32Array }): Promise<void>;
  copyText?(text: string): Promise<void>;
  pasteImage?(): Promise<{ w: number; h: number; data: Uint32Array } | null>;
  windowId: string;
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
  mcp?(enabled?: boolean, port?: number): Promise<McpState>;
};

export { editMethods } from '../src/core/automation/methods';

declare global { interface Window { pixpriteDesktop?: DesktopBridge } }
