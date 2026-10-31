/** Release checks only notify; installation is handled by the user outside the editor. */
export type UpdateState = { currentVersion: string; version?: string; url?: string };
export type UpdateAction = 'check' | 'open';
