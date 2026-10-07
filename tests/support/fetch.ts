/**
 * Helpers for replacing the global `fetch` (the network boundary) with
 * scripted responses. Responses are real WHATWG `Response` objects.
 */
export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit | undefined]>;

/** Installs a jest.fn as global fetch that answers each call with the next scripted step. */
export const scriptFetch = (...steps: (Response | Error | (() => Promise<Response>))[]): FetchMock => {
  const mock: FetchMock = jest.fn((_url: RequestInfo | URL, _init: RequestInit | undefined) => {
    const step = steps.shift();
    if (step === undefined) return Promise.reject(new Error('Unexpected extra fetch call'));
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return step();
    return Promise.resolve(step);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
};

/** A fetch that never answers on its own and rejects like real fetch once its signal aborts. */
export const hangingFetch = (): FetchMock => {
  const mock: FetchMock = jest.fn(
    (_url: RequestInfo | URL, init: RequestInit | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      }),
  );
  global.fetch = mock as unknown as typeof fetch;
  return mock;
};

/** The URL passed to the n-th fetch call. */
export const calledUrl = (mock: FetchMock, n = 0): string => String(mock.mock.calls[n]?.[0]);
