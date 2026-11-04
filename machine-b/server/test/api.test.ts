/** End-to-end tests of the HTTP routes through the real Express app, with no network to Anthropic. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_STATE } from "../src/contract.js";
import type { AgentResponse, MemoResponse } from "../src/contract.js";
import { createApp } from "../src/index.js";
import { setClientForTests } from "../src/llm.js";

const HEADINGS = ["Sintesi", "Dove investire", "Perché queste zone", "Cosa è già finanziato", "Limiti dei dati", "Fonti"];
const memoRequest = JSON.parse(readFileSync(new URL("../samples/memo-request.json", import.meta.url), "utf8"));

let server: Server;
let base = "";

before(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  setClientForTests(undefined);
});

afterEach(() => setClientForTests(null));

async function post<T>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as T };
}

function fakeClient(respond: () => unknown): Anthropic {
  return {
    beta: { messages: { create: async () => respond() } },
  } as unknown as Anthropic;
}

function assertAgentShape(body: AgentResponse): void {
  assert.equal(typeof body.reply, "string");
  assert.ok(body.reply.length > 0, "reply must not be empty");
  assert.ok(Array.isArray(body.actions));
  assert.equal(typeof body.needs_clarification, "boolean");
  assert.ok(body.mode === "llm" || body.mode === "rules");
}

test("health reports the real mode", async () => {
  setClientForTests(null);
  const rules = await fetch(`${base}/api/health`);
  assert.deepEqual(await rules.json(), { ok: true, mode: "rules" });

  setClientForTests(fakeClient(() => ({})));
  const llm = await fetch(`${base}/api/health`);
  assert.deepEqual(await llm.json(), { ok: true, mode: "llm" });
});

test("agent in rules mode handles the example from the brief", async () => {
  setClientForTests(null);
  const { status, json } = await post<AgentResponse>("/api/agent", {
    messages: [{ role: "user", content: "ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR" }],
    state: DEFAULT_STATE,
  });
  assert.equal(status, 200);
  assertAgentShape(json);
  assert.equal(json.mode, "rules");
  assert.deepEqual(
    json.actions.map((action) => action.tool),
    ["set_budget", "set_weights", "filter_zones", "run_plan"],
  );
  assert.deepEqual(json.actions[0]?.args, { budget_eur: 200000 });
  assert.deepEqual(json.actions[2]?.args, { exclude_funded: true });
});

test("agent answers 400 on a malformed body, and keeps serving", async () => {
  setClientForTests(null);
  for (const body of [{}, [], { messages: "ciao", state: {} }, { messages: [] }, { messages: [], state: 5 }, { messages: [{ role: "user" }], state: null }]) {
    const { status, json } = await post<{ error: string }>("/api/agent", body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.ok(json.error);
  }
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
});

test("agent asks a question when the body is well formed but has no usable message", async () => {
  setClientForTests(null);
  for (const body of [{ messages: [], state: {} }, { messages: [{ role: "user" }], state: {} }]) {
    const { status, json } = await post<AgentResponse>("/api/agent", body);
    assert.equal(status, 200);
    assertAgentShape(json);
    assert.equal(json.needs_clarification, true);
    assert.deepEqual(json.actions, []);
  }
});

test("broken JSON gets a clean 400", async () => {
  const response = await fetch(`${base}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.ok(body.error);
  assert.ok(!JSON.stringify(body).includes("SyntaxError"));
});

test("agent in LLM mode returns validated, clamped actions", async () => {
  setClientForTests(
    fakeClient(() => ({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "set_budget", input: { budget_eur: 200000 } },
        { type: "tool_use", id: "t2", name: "run_plan", input: {} },
        { type: "tool_use", id: "t3", name: "rispondi", input: { reply: "Ho impostato il budget.", needs_clarification: false } },
      ],
    })),
  );
  const { status, json } = await post<AgentResponse>("/api/agent", {
    messages: [{ role: "user", content: "ho 200.000 euro" }],
    state: DEFAULT_STATE,
  });
  assert.equal(status, 200);
  assertAgentShape(json);
  assert.equal(json.mode, "llm");
  assert.deepEqual(json.actions, [
    { tool: "set_budget", args: { budget_eur: 200000 } },
    { tool: "run_plan", args: {} },
  ]);
  assert.equal(json.reply, "Ho impostato il budget.");
});

test("agent falls back to rules and says so when the LLM throws", async () => {
  setClientForTests({
    beta: {
      messages: {
        create: async () => {
          throw new Error("boom");
        },
      },
    },
  } as unknown as Anthropic);
  const { status, json } = await post<AgentResponse>("/api/agent", {
    messages: [{ role: "user", content: "ho 300k" }],
    state: DEFAULT_STATE,
  });
  assert.equal(status, 200);
  assert.equal(json.mode, "rules");
  assert.deepEqual(json.actions[0], { tool: "set_budget", args: { budget_eur: 300000 } });
});

test("memo returns the six sections from the template without a key", async () => {
  setClientForTests(null);
  const { status, json } = await post<MemoResponse>("/api/memo", memoRequest);
  assert.equal(status, 200);
  assert.equal(json.mode, "rules");
  let last = -1;
  for (const heading of HEADINGS) {
    const at = json.markdown.indexOf(`## ${heading}`);
    assert.ok(at > last, `heading out of order or missing: ${heading}`);
    last = at;
  }
  assert.match(json.markdown, /DATI DI PROVA/);
  assert.match(json.markdown, /indice di ritorno atteso/i);
  assert.doesNotMatch(json.markdown, /SROI/i);
  assert.doesNotMatch(json.markdown, /\b(?:null|undefined|NaN)\b/);
});

test("memo answers 400 without state or with a non-list field", async () => {
  for (const body of [{}, [], { state: 5 }, { state: {}, plan: "x" }, { state: {}, zones: {} }, { state: {}, sources: 3 }]) {
    const { status, json } = await post<{ error: string }>("/api/memo", body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.ok(json.error);
  }
});

test("memo uses state.plan when the body has no plan, and handles an empty state", async () => {
  setClientForTests(null);
  const fromState = await post<MemoResponse>("/api/memo", {
    state: { ...memoRequest.state, plan: memoRequest.plan },
    zones: memoRequest.zones,
    sources: memoRequest.sources,
  });
  assert.equal(fromState.status, 200);
  assert.match(fromState.json.markdown, /Pilonetto/);

  const empty = await post<MemoResponse>("/api/memo", { state: {} });
  assert.equal(empty.status, 200);
  for (const heading of HEADINGS) assert.ok(empty.json.markdown.includes(`## ${heading}`), heading);
});

test("memo accepts the full 94-zone payload", async () => {
  setClientForTests(null);
  const zone = memoRequest.zones[0];
  const zones = Array.from({ length: 94 }, (_, i) => ({ ...zone, id: i + 1, name: `Zona ${i + 1}` }));
  const { status, json } = await post<MemoResponse>("/api/memo", { ...memoRequest, zones });
  assert.equal(status, 200);
  assert.ok(json.markdown.length > 0);
});
