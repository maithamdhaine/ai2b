import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS, getHealth, postAgent, postMemo } from '../../lib/api';
import type { PlannerState } from '../../types';

const state: PlannerState = {
  profile: 'foundation',
  budget_eur: 100000,
  weights: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  filters: { circ: [], exclude_funded: false, min_over75: 0 },
  selected_zone_id: null,
  plan: [],
};

const memoBody = { state, plan: [], zones: [], sources: [], mock: false };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

const mockFetch = (implementation: (url: string, init?: RequestInit) => Promise<Response>) => {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** A server that never answers: fetch only settles when it is aborted, like the real one. */
const hangingFetch = () => mockFetch((_url, init) => new Promise((_resolve, reject) => {
  const abort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (init?.signal?.aborted) abort();
  init?.signal?.addEventListener('abort', abort);
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('successful calls', () => {
  it('GET /api/health returns the mode', async () => {
    const fetchMock = mockFetch(async () => json({ ok: true, mode: 'rules' }));
    expect(await getHealth()).toEqual({ ok: true, data: { ok: true, mode: 'rules' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/health');
  });

  it('POST /api/agent sends messages and state, and returns the reply', async () => {
    const fetchMock = mockFetch(async () => json({
      reply: ' Fatto. ', actions: [{ tool: 'run_plan', args: {} }], needs_clarification: true, mode: 'llm',
    }));
    const messages = [{ role: 'user' as const, content: 'ciao' }];

    const result = await postAgent(messages, state);

    expect(result).toEqual({
      ok: true,
      data: { reply: 'Fatto.', actions: [{ tool: 'run_plan', args: {} }], needs_clarification: true, mode: 'llm' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/agent');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ messages, state });
  });

  it('POST /api/memo sends state, plan, zones and sources', async () => {
    const fetchMock = mockFetch(async () => json({ markdown: '# Memo', mode: 'llm' }));
    expect(await postMemo(memoBody)).toEqual({ ok: true, data: { markdown: '# Memo', mode: 'llm' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/memo');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(memoBody);
  });
});

describe('server off', () => {
  it('turns a refused connection into a failure', async () => {
    mockFetch(async () => { throw new TypeError('Failed to fetch'); });
    expect(await postAgent([], state)).toEqual({
      ok: false, reason: 'offline', message: 'Il server AI non è raggiungibile.',
    });
  });

  it('recognises the empty 500 the Vite proxy sends when the server is off', async () => {
    mockFetch(async () => new Response('', { status: 500, headers: { 'Content-Type': 'text/plain' } }));
    expect(await getHealth()).toMatchObject({ ok: false, reason: 'offline' });
  });

  it('is not fooled by an HTML page answered with 200', async () => {
    mockFetch(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
    expect(await postMemo(memoBody)).toMatchObject({ ok: false, reason: 'offline' });
  });
});

describe('bad answers', () => {
  it('reports a JSON error from the server, with its status', async () => {
    mockFetch(async () => json({ error: 'boom' }, 503));
    expect(await postAgent([], state)).toEqual({
      ok: false, reason: 'server_error', status: 503, message: 'Il server AI ha segnalato un errore.',
    });
  });

  it('reports a broken JSON body', async () => {
    mockFetch(async () => new Response('{"reply":', { headers: { 'Content-Type': 'application/json' } }));
    expect(await postAgent([], state)).toMatchObject({ ok: false, reason: 'bad_response' });
  });

  it.each([
    ['an array', []],
    ['a null body', null],
    ['no reply and no actions', { mode: 'llm' }],
  ])('refuses an agent answer that is %s', async (_name, body) => {
    mockFetch(async () => json(body));
    expect(await postAgent([], state)).toMatchObject({ ok: false, reason: 'bad_response' });
  });

  it('claims llm mode only when the server says so', async () => {
    mockFetch(async () => json({ reply: 'ok' }));
    expect(await postAgent([], state)).toEqual({
      ok: true, data: { reply: 'ok', actions: [], needs_clarification: false, mode: 'rules' },
    });
  });

  it('refuses a memo with no text', async () => {
    mockFetch(async () => json({ markdown: '   ', mode: 'llm' }));
    expect(await postMemo(memoBody)).toMatchObject({ ok: false, reason: 'bad_response' });
  });

  it('refuses a health answer that is not ok', async () => {
    mockFetch(async () => json({ ok: false, mode: 'llm' }));
    expect(await getHealth()).toMatchObject({ ok: false, reason: 'bad_response' });
  });
});

describe('timeouts', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('gives up on the agent after 15 seconds, and not before', async () => {
    hangingFetch();
    const settled = vi.fn();
    const pending = postAgent([], state).then((result) => { settled(); return result; });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({
      ok: false, reason: 'timeout', message: 'Il server AI non ha risposto entro 15 secondi.',
    });
  });

  it('gives up on the memo after 30 seconds, and not before', async () => {
    hangingFetch();
    const settled = vi.fn();
    const pending = postMemo(memoBody).then((result) => { settled(); return result; });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('keeps the agreed limits', () => {
    expect(API_TIMEOUT_MS).toMatchObject({ agent: 15_000, memo: 30_000 });
  });

  it('leaves no timer behind after an answer', async () => {
    mockFetch(async () => json({ ok: true, mode: 'llm' }));
    await getHealth();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('abort by the caller', () => {
  it('stops a running call', async () => {
    hangingFetch();
    const controller = new AbortController();
    const pending = postMemo(memoBody, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'aborted' });
  });

  it('does not even wait for a call that starts already aborted', async () => {
    hangingFetch();
    expect(await postMemo(memoBody, AbortSignal.abort())).toMatchObject({ ok: false, reason: 'aborted' });
  });
});
