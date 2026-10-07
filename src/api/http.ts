import type { z } from 'zod';

import { log } from '@/utils/logger';

export type NetworkErrorKind = 'offline' | 'timeout' | 'http' | 'rate_limited' | 'invalid_response' | 'aborted';

export class NetworkError extends Error {
  constructor(
    readonly kind: NetworkErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions<T> {
  /** zod schema the response must satisfy; malformed data throws `invalid_response`. */
  schema: z.ZodType<T>;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: 'GET' | 'POST';
  body?: string;
  /** Minimum spacing between requests to the same host (usage policies). */
  minIntervalMs?: number;
  /** Label for latency metrics / logs. */
  label: string;
}

export interface LatencySample {
  label: string;
  status: number | 'error';
  ms: number;
  at: number;
}

const latency: LatencySample[] = [];
export const getLatencySamples = (): readonly LatencySample[] => latency;
const recordLatency = (s: LatencySample): void => {
  latency.push(s);
  if (latency.length > 100) latency.shift();
};

const lastRequestAt = new Map<string, number>();
const hostOf = (url: string): string => {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m?.[1]?.toLowerCase() ?? url;
};

const abortedError = (): NetworkError => new NetworkError('aborted', 'Request cancelled.');

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortedError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const throttle = async (url: string, minIntervalMs: number | undefined, signal?: AbortSignal): Promise<void> => {
  if (!minIntervalMs) return;
  const host = hostOf(url);
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  lastRequestAt.set(host, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await sleep(wait, signal);
};

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(60_000, Math.max(0, secs * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(60_000, Math.max(0, date - Date.now())) : undefined;
};

const isRetryable = (e: unknown): boolean =>
  e instanceof NetworkError &&
  (e.kind === 'timeout' || e.kind === 'offline' || e.kind === 'rate_limited' || (e.kind === 'http' && (e.status ?? 0) >= 500));

const attempt = async <T>(url: string, opts: RequestOptions<T>): Promise<T> => {
  // An 'abort' listener never fires for a signal that is already aborted.
  if (opts.signal?.aborted) throw abortedError();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const onAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const started = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { Accept: 'application/json', ...opts.headers },
        body: opts.body,
        signal: controller.signal,
      });
    } catch {
      if (opts.signal?.aborted) throw abortedError();
      if (controller.signal.aborted) throw new NetworkError('timeout', `${opts.label} timed out.`);
      throw new NetworkError('offline', `Couldn't reach ${hostOf(url)}.`);
    }
    recordLatency({ label: opts.label, status: res.status, ms: Date.now() - started, at: Date.now() });
    if (res.status === 429) {
      throw new NetworkError('rate_limited', `${opts.label} is rate limiting requests.`, 429, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (!res.ok) {
      throw new NetworkError('http', `${opts.label} responded with ${res.status}.`, res.status);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new NetworkError('invalid_response', `${opts.label} returned data that isn't valid JSON.`);
    }
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      log.warn('Network', 'schema mismatch', { label: opts.label, issues: parsed.error.issues.length });
      throw new NetworkError('invalid_response', `${opts.label} returned data in an unexpected format.`);
    }
    return parsed.data;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    if (e.kind !== 'http' && e.kind !== 'rate_limited' && e.kind !== 'invalid_response') {
      recordLatency({ label: opts.label, status: 'error', ms: Date.now() - started, at: Date.now() });
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
};

/** GET/POST JSON with timeout, bounded retries (backoff + Retry-After), host throttling and schema validation. */
export const requestJson = async <T>(url: string, opts: RequestOptions<T>): Promise<T> => {
  const retries = opts.retries ?? 1;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    await throttle(url, opts.minIntervalMs, opts.signal);
    try {
      return await attempt(url, opts);
    } catch (e) {
      lastError = e;
      if (i === retries || !isRetryable(e)) break;
      const backoff = e instanceof NetworkError && e.retryAfterMs !== undefined ? e.retryAfterMs : 600 * 2 ** i;
      await sleep(backoff, opts.signal);
    }
  }
  throw lastError;
};

export const describeNetworkError = (e: unknown): string => {
  if (e instanceof NetworkError) {
    switch (e.kind) {
      case 'offline':
        return "You're offline or the service is unreachable.";
      case 'timeout':
        return 'The service took too long to respond.';
      case 'rate_limited':
        return 'The service is busy. Try again in a minute.';
      case 'invalid_response':
        return 'The service returned data we could not read.';
      case 'aborted':
        return 'Cancelled.';
      case 'http':
        return e.status && e.status >= 500 ? 'The service is having problems right now.' : 'The service rejected the request.';
    }
  }
  return 'Something went wrong while contacting the service.';
};
