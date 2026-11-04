/** Live-demo failure modes: the real SDK against a local server, plus the browser's view of the HTTP API. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import AnthropicSdk from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "../src/agent.js";
import { DEFAULT_STATE } from "../src/contract.js";
import type { ChatMessage, MemoRequest } from "../src/contract.js";
import { createApp } from "../src/index.js";
import { currentMode, getClient, parseEnvFile, setClientForTests } from "../src/llm.js";
import { buildFacts, checkMemo, templateMemo, writeMemo } from "../src/memo.js";
import { findUnsupportedNumbers } from "../src/numbers.js";
import { normalizeState } from "../src/validate.js";

const user = (content: string): ChatMessage => ({ role: "user", content });
const state = () => structuredClone(DEFAULT_STATE);

afterEach(() => setClientForTests(undefined));

type Handler = (body: { max_tokens?: number }, req: IncomingMessage, res: ServerResponse) => void;

async function fakeApi(handler: Handler): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => handler(JSON.parse(raw || "{}"), req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function realClient(url: string): Anthropic {
  return new AnthropicSdk({ apiKey: "test-key", baseURL: url, maxRetries: 0 });
}

const isWarmUp = (body: { max_tokens?: number }) => body.max_tokens === 32;

for (const route of ["agent", "memo"] as const) {
  test(`${route}: the timeout really closes the connection to the API`, async () => {
    let closedAt = 0;
    const api = await fakeApi((body, _req, res) => {
      if (isWarmUp(body)) return;
      res.on("close", () => {
        closedAt = Date.now();
      });
    });
    setClientForTests(realClient(api.url));
    const started = Date.now();
    const mode =
      route === "agent"
        ? (await runAgent([user("ho 200k")], state(), { timeoutMs: 200 })).mode
        : (await writeMemo({ state: state(), plan: [], zones: [], sources: [] }, { timeoutMs: 200 })).mode;
    assert.equal(mode, "rules");
    assert.ok(Date.now() - started < 1500, "must answer soon after the timeout");
    for (let i = 0; i < 50 && closedAt === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(closedAt > 0, "the server must see the request cancelled");
    await api.stop();
  });

  for (const status of [401, 429, 500, 529]) {
    test(`${route}: HTTP ${status} fails over at once, with a single attempt`, async () => {
      let attempts = 0;
      const api = await fakeApi((body, _req, res) => {
        if (!isWarmUp(body)) attempts += 1;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }));
      });
      setClientForTests(realClient(api.url));
      const started = Date.now();
      const mode =
        route === "agent"
          ? (await runAgent([user("ho 200k")], state())).mode
          : (await writeMemo({ state: state(), plan: [], zones: [], sources: [] })).mode;
      assert.equal(mode, "rules");
      assert.ok(Date.now() - started < 1000, "no waiting on a failure the API already reported");
      assert.equal(attempts, 1);
      await api.stop();
    });
  }
}

test("an invalid key from the environment flips to rules, stops calling the API, and survives", async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
  let attempts = 0;
  const api = await fakeApi((body, _req, res) => {
    if (!isWarmUp(body)) attempts += 1;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid" } }));
  });
  process.env.ANTHROPIC_API_KEY = "sk-invalid-for-test";
  process.env.ANTHROPIC_BASE_URL = api.url;
  try {
    setClientForTests(undefined);
    const first = await runAgent([user("ho 200k")], state());
    assert.equal(first.mode, "rules");
    assert.equal(first.actions[0]?.tool, "set_budget");
    assert.equal(getClient(), null);
    assert.equal(currentMode(), "rules");
    const second = await runAgent([user("ho 300k")], state());
    assert.equal(second.mode, "rules");
    assert.equal(attempts, 1, "a rejected key is not retried on every request");
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.url;
    await api.stop();
  }
});

test(".env is read whatever encoding Windows wrote it in", () => {
  const line = "ANTHROPIC_API_KEY=abc123\n";
  const expected = { ANTHROPIC_API_KEY: "abc123" };
  assert.deepEqual(parseEnvFile(Buffer.from(line)), expected);
  assert.deepEqual(parseEnvFile(Buffer.from(`﻿${line}`)), expected);
  assert.deepEqual(parseEnvFile(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line, "utf16le")])), expected);
  assert.deepEqual(parseEnvFile(Buffer.from("ANTHROPIC_API_KEY=abc123\r\n")), expected);
});

// ---------------------------------------------------------------------------
// Mixed and hallucinated content
// ---------------------------------------------------------------------------

function fake(content: unknown[], stop_reason = "tool_use"): void {
  setClientForTests({
    beta: { messages: { create: async () => ({ content, stop_reason }) } },
  } as unknown as Anthropic);
}
const call = (name: string, input: unknown = {}) => ({ type: "tool_use", id: `t_${name}`, name, input });
const rispondi = (reply: string) => call("rispondi", { reply, needs_clarification: false });

const LEAKED_TEXT = [
  '```json\n{"tool":"set_budget","args":{"budget_eur":900000}}\n```',
  '{"tool":"set_budget","args":{"budget_eur":900000}}',
  "Chiamo set_budget con 200000.",
  '<function_calls><invoke name="set_budget"></invoke></function_calls>',
  "<thinking>devo calcolare</thinking>",
];

for (const text of LEAKED_TEXT) {
  test(`a tool call written as text is never run or shown: ${text.slice(0, 30)}`, async () => {
    fake([{ type: "text", text }], "end_turn");
    const result = await runAgent([user("ho 200k")], state());
    assert.equal(result.mode, "rules");
    assert.deepEqual(result.actions[0], { tool: "set_budget", args: { budget_eur: 200000 } });
    assert.ok(!result.reply.includes("```") && !result.reply.includes("{") && !result.reply.includes("<"));
  });

  test(`real calls survive stray text around them: ${text.slice(0, 30)}`, async () => {
    fake([{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }, call("set_budget", { budget_eur: 200000 }), call("run_plan")]);
    const result = await runAgent([user("ho 200k")], state());
    assert.equal(result.mode, "llm");
    assert.deepEqual(result.actions.map((a) => a.tool), ["set_budget", "run_plan"]);
    assert.ok(!result.reply.includes("```") && !result.reply.includes("{") && !result.reply.includes("<"));
    assert.ok(result.reply.length > 0);
  });

  test(`a leaked call inside rispondi is replaced: ${text.slice(0, 30)}`, async () => {
    fake([call("set_budget", { budget_eur: 200000 }), call("run_plan"), rispondi(text)]);
    const result = await runAgent([user("ho 200k")], state());
    assert.equal(result.mode, "llm");
    assert.ok(!result.reply.includes("```") && !result.reply.includes("{") && !result.reply.includes("<"));
  });
}

test("a thinking tag is removed and the real text kept", async () => {
  fake([{ type: "text", text: "<thinking>nota</thinking>Quale budget vuoi destinare?" }], "end_turn");
  const result = await runAgent([user("aiuto")], state());
  assert.equal(result.mode, "llm");
  assert.equal(result.reply, "Quale budget vuoi destinare?");
  assert.equal(result.needs_clarification, true);
});

test("tool input that is a string, or content that is not a list, falls back", async () => {
  fake([call("set_budget", '```json\n{"budget_eur":200000}\n```'), rispondi("Fatto.")]);
  assert.equal((await runAgent([user("ho 200k")], state())).mode, "rules");
  setClientForTests({ beta: { messages: { create: async () => ({ stop_reason: "tool_use" }) } } } as unknown as Anthropic);
  assert.equal((await runAgent([user("ho 200k")], state())).mode, "rules");
});

test("garbage plan items in the state do not break either mode", async () => {
  const dirty = normalizeState({ ...state(), plan: [null, 3, "x", { zone_id: 70 }] });
  assert.equal(dirty.plan.length, 1);
  fake([call("select_zone", { zone_id: 70 }), rispondi("Apro la zona.")]);
  assert.equal((await runAgent([user("apri la zona 70")], dirty)).mode, "llm");
  setClientForTests(null);
  assert.equal((await runAgent([user("apri la zona 70")], dirty)).mode, "rules");
});

// ---------------------------------------------------------------------------
// What the browser sees
// ---------------------------------------------------------------------------

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const origin of ["http://localhost:5173", "http://localhost:3000"]) {
  test(`CORS allows ${origin}`, async () => {
    setClientForTests(null);
    await withApp(async (base) => {
      const preflight = await fetch(`${base}/api/agent`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
      assert.ok(preflight.status < 300);
      assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /GET/);
      assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Content-Type/i);

      const health = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
      assert.equal(health.headers.get("access-control-allow-origin"), "*");

      // Errors need the header too, or the browser reports a CORS failure instead of the 400.
      for (const body of ["{not json", "{}"]) {
        const bad = await fetch(`${base}/api/agent`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body,
        });
        assert.equal(bad.status, 400);
        assert.equal(bad.headers.get("access-control-allow-origin"), "*");
      }
    });
  });
}

test("every error is JSON: unknown route, no content type, oversized body", async () => {
  setClientForTests(null);
  await withApp(async (base) => {
    const missing = await fetch(`${base}/api/nope`);
    assert.equal(missing.status, 404);
    assert.ok(((await missing.json()) as { error: string }).error);

    const noType = await fetch(`${base}/api/agent`, { method: "POST", body: "ciao" });
    assert.equal(noType.status, 400);
    assert.ok(((await noType.json()) as { error: string }).error);

    const huge = await fetch(`${base}/api/memo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: {}, zones: [], pad: "x".repeat(11 * 1024 * 1024) }),
    });
    assert.equal(huge.status, 413);
    assert.ok(((await huge.json()) as { error: string }).error);

    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

// ---------------------------------------------------------------------------
// Memo markdown and Italian numbers
// ---------------------------------------------------------------------------

const payload = { budget: 100000, people: 1140, index: 1.234, share: 0.42, decimal: 104.86, big: 1500000, score: 62 };

for (const text of [
  "100.000 €", "100000 €", "€ 100.000", "100.000,00 €", "**100.000 €**", "100.000.", "100 000 €", "100 000 €", "100 000 €",
  "100k", "100 mila euro", "centomila euro", "100,000 €",
  "1.140 persone", "1140 persone", "1,140 persone",
  "indice 1,234", "indice 1.234",
  "42%", "42 %", "42 per cento", "0,42", "0.42",
  "104,86 €", "104.86 €", "1.500.000 €", "1,5 milioni", "1,500,000 €",
  "isolamento 62/100",
]) {
  test(`number check accepts "${text}"`, () => {
    assert.deepEqual(findUnsupportedNumbers(text, payload), []);
  });
}

for (const [text, flagged] of [
  ["100.001 €", "100.001 €"],
  ["200.000 €", "200.000 €"],
  ["43%", "43%"],
  ["1.141 persone", "1.141"],
  ["200 000 €", "200 000 €"],
  ["1,6 milioni", "1,6 milioni"],
]) {
  test(`number check still rejects "${text}"`, () => {
    const found = findUnsupportedNumbers(text as string, { budget: 100000, people: 1140, share: 0.42, big: 1500000 });
    assert.equal(found.length, 1);
    assert.ok(found[0]?.startsWith((flagged as string).split(" ")[0] ?? ""), String(found));
  });
}

test("a bare integer inside a space-separated run is not joined without a currency", () => {
  assert.deepEqual(findUnsupportedNumbers("Circ. 8 465 persone", { circ: 8, people: 465 }), []);
});

const REQUEST: MemoRequest = {
  state: state(),
  plan: [
    {
      zone_id: 1, zone_name: "Borgo **Po | Sud", circ: 8, intervention_id: "a", intervention_label: "Visite `a` domicilio", budget_eur: 1000,
      people_reached: 10, cost_per_person_eur: 100, return_index: 0.5,
      scores: { isolation: 1, service_gap: 2, future_pressure: 3, inclusion: 4, funded_share: 0 }, confidence: "low",
    },
  ],
  zones: [],
  sources: [{ key: "k", label: "Fonte [uno] *prova*", url: "https://example.org/a(b", year: 2025, level: "zona" }],
};

test("awkward names and URLs from the data keep the template's markdown valid", () => {
  const markdown = templateMemo(REQUEST);
  assert.deepEqual(checkMemo(markdown, { ...buildFacts(REQUEST), sources: [{ ...REQUEST.sources[0]!, url: "https://example.org/a%28b" }] }), []);
  assert.match(markdown, /\[Fonte uno prova\]\(https:\/\/example\.org\/a%28b\) \(2025\)/);
  assert.match(markdown, /\| Borgo Po \/ Sud \|/);
});

test("the memo code path never cuts a string: long labels stay whole and the markdown stays valid", () => {
  const long = "Etichetta molto lunga ".repeat(40).trim();
  const markdown = templateMemo({ ...REQUEST, sources: Array.from({ length: 15 }, (_, i) => ({ key: `k${i}`, label: `${long} ${i}`, url: `https://example.org/${i}`, year: 2025, level: "zona" })) });
  for (let i = 0; i < 15; i += 1) assert.ok(markdown.includes(`[${long} ${i}](https://example.org/${i}) (2025)`));
  assert.equal((markdown.match(/\*\*/g) ?? []).length % 2, 0);
});

for (const [name, broken] of [
  ["an open bold", "## Sintesi\n\nTesto **grassetto"],
  ["a code fence", "## Sintesi\n\n```\nTesto"],
  ["a broken link", "## Sintesi\n\n[Fonte(https://x.org)"],
  ["an uneven table", "## Sintesi\n\n| a | b |\n| --- | --- |\n| 1 |"],
] as const) {
  test(`LLM text with ${name} is rejected`, () => {
    const failures = checkMemo(broken, buildFacts({ state: state(), plan: [], zones: [], sources: [] }));
    assert.ok(failures.some((failure) => failure.startsWith("markdown non valido")), failures.join("; "));
  });
}
