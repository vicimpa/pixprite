/** Single-window session keys; old per-window keys are retained only for recovery. */
import type {} from '../../desktop/protocol';
export const windowSessionId = () => 'main';
export const windowSessionKey = (id = windowSessionId()) => id === 'main' ? 'pixprite:session' : `pixprite:session:window:${id}`;
export const windowRunningKey = () => `pixprite:running${windowSessionId() === 'main' ? '' : `:window:${windowSessionId()}`}`;
