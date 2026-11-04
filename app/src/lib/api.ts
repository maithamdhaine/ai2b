import type {
  AgentResponse, ChatMessage, MemoResponse, PlanItem, PlannerState, SourceRef, ZoneProps,
} from '../types';

export const API_TIMEOUT_MS = { health: 3_000, agent: 15_000, memo: 30_000 } as const;

export type ApiFailureReason = 'offline' | 'timeout' | 'server_error' | 'bad_response' | 'aborted';

export interface ApiFailure {
  ok: false;
  reason: ApiFailureReason;
  /** Italian, ready to show to the user. */
  message: string;
  status?: number;
}

/** These functions never reject: every problem comes back as an ApiFailure. */
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export interface HealthResponse {
  ok: true;
  mode: 'llm' | 'rules';
}

/** Actions stay unknown here: they come from outside the app, and are checked one by one before use. */
export type AgentReply = Omit<AgentResponse, 'actions'> & { actions: unknown[] };

export interface MemoRequestBody {
  state: PlannerState;
  plan: PlanItem[];
  zones: ZoneProps[];
  sources: SourceRef[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const failure = (reason: ApiFailureReason, message: string, status?: number): ApiFailure =>
  (status === undefined ? { ok: false, reason, message } : { ok: false, reason, message, status });

const offline = () => failure('offline', 'Il server AI non è raggiungibile.');
const unreadable = () => failure('bad_response', 'Il server AI ha inviato una risposta non leggibile.');

interface RequestOptions {
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  { body, timeoutMs, signal }: RequestOptions,
  parse: (json: unknown) => T | null,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(path, body === undefined ? { signal: controller.signal } : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // With the server off, the Vite proxy itself answers: a 500 with an empty text/plain body.
    // Only the AI server answers in JSON, so anything else means it is not there.
    if (!(response.headers.get('content-type') ?? '').includes('json')) return offline();

    const json: unknown = await response.json();
    if (!response.ok) {
      return failure('server_error', 'Il server AI ha segnalato un errore.', response.status);
    }
    const data = parse(json);
    return data === null ? unreadable() : { ok: true, data };
  } catch (error) {
    if (timedOut) {
      return failure('timeout', `Il server AI non ha risposto entro ${timeoutMs / 1000} secondi.`);
    }
    if (signal?.aborted) return failure('aborted', 'Richiesta annullata.');
    // fetch reports a refused connection as a TypeError; a broken JSON body is a SyntaxError.
    return error instanceof SyntaxError ? unreadable() : offline();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function parseHealth(json: unknown): HealthResponse | null {
  if (!isRecord(json) || json.ok !== true) return null;
  return json.mode === 'llm' || json.mode === 'rules' ? { ok: true, mode: json.mode } : null;
}

function parseAgent(json: unknown): AgentReply | null {
  if (!isRecord(json)) return null;
  const { reply, actions, needs_clarification: needsClarification, mode } = json;
  if (typeof reply !== 'string' && !Array.isArray(actions)) return null;
  return {
    reply: typeof reply === 'string' ? reply.trim() : '',
    actions: Array.isArray(actions) ? actions : [],
    needs_clarification: needsClarification === true,
    // "AI attiva" is a claim shown to the jury, so it needs an explicit llm.
    mode: mode === 'llm' ? 'llm' : 'rules',
  };
}

function parseMemo(json: unknown): MemoResponse | null {
  if (!isRecord(json) || typeof json.markdown !== 'string' || !json.markdown.trim()) return null;
  const mode = json.mode === 'llm' || json.mode === 'rules' ? json.mode : 'template';
  return { markdown: json.markdown, mode };
}

export const getHealth = (signal?: AbortSignal) =>
  request('/api/health', { timeoutMs: API_TIMEOUT_MS.health, signal }, parseHealth);

export const postAgent = (messages: ChatMessage[], state: PlannerState, signal?: AbortSignal) =>
  request('/api/agent', { body: { messages, state }, timeoutMs: API_TIMEOUT_MS.agent, signal }, parseAgent);

export const postMemo = (body: MemoRequestBody, signal?: AbortSignal) =>
  request('/api/memo', { body, timeoutMs: API_TIMEOUT_MS.memo, signal }, parseMemo);
