/**
 * What every RPC handler gets: the calling extension, the endpoint (worker or one of its iframes)
 * and the transaction the call belongs to.
 */
import type { ErrorCode } from "../protocol";
import type { Method } from "../protocol";
import type { ExtensionHost, Endpoint } from "../Host";

export type Call = { host: ExtensionHost; endpoint: Endpoint; tx?: number; };

export type Handler = (c: Call, ...params: any[]) => unknown;
export type Handlers = Partial<Record<Method, Handler>>;

/** A rejection the extension sees with its `code` */
export class HostError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}

export const fail = (code: ErrorCode, message: string): never => { throw new HostError(code, message); };

/** Running extensions by id (filled by the runtime) */
export const hosts = new Map<string, ExtensionHost>();

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const int = (v: unknown, what: string) => Number.isInteger(v) ? v as number : fail('invalid', `${what} must be an integer`);
