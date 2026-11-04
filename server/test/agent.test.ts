import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import AnthropicSdk from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, warmUp } from "../src/agent.js";
import { AGENT_TIMEOUT_MS, DEFAULT_STATE, TOOL_NAMES } from "../src/contract.js";
import type { AppState, ChatMessage, PlanItem } from "../src/contract.js";
import { modelName, setClientForTests } from "../src/llm.js";
import { findUnsupportedNumbers } from "../src/numbers.js";
import { SYSTEM_PROMPT, TOOLS } from "../src/prompts.js";

interface SentRequest {
  max_tokens: number;
  messages: Array<{ role: string; content: unknown }>;
  [key: string]: unknown;
}

/** A fake client. Warm-up requests are recorded apart, so tests only look at the real call. */
function fakeClient(respond: () => unknown) {
  const sent: SentRequest[] = [];
  const warmUps: SentRequest[] = [];
  const options: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        create: (request: SentRequest, requestOptions: Record<string, unknown>) => {
          if (request.max_tokens === 1500) {
            sent.push(request);
            options.push(requestOptions);
          } else {
            warmUps.push(request);
          }
          return respond();
        },
      },
    },
  } as unknown as Anthropic;
  setClientForTests(client);
  return { sent, warmUps, options };
}

const call = (name: string, input: unknown = {}) => ({ type: "tool_use", id: `toolu_${name}`, name, input });
const reply = (text: string, needs_clarification = false) => call("rispondi", { reply: text, needs_clarification });
const message = (content: unknown[], stop_reason = "tool_use") => async () => ({ content, stop_reason });
const user = (content: string): ChatMessage => ({ role: "user", content });

const weights = { isolation: 0.6, service_gap: 0.2, future_pressure: 0.15, inclusion: 0.05 };
const budgetAsk = [user("ho 200.000 euro")];

function stateWith(overrides: Partial<AppState> = {}): AppState {
  return { ...structuredClone(DEFAULT_STATE), ...overrides };
}

function planItem(zone_id: number): PlanItem {
  return {
    zone_id,
    zone_name: "Zona di prova",
    circ: 1,
    intervention_id: "i1",
    intervention_label: "Intervento",
    budget_eur: 1000,
    people_reached: 10,
    cost_per_person_eur: 100,
    return_index: 1.5,
    scores: { isolation: 0.5, service_gap: 0.5, future_pressure: 0.5, inclusion: 0.5, funded_share: 0 },
    confidence: "estimated",
  };
}

afterEach(() => setClientForTests(undefined));

test("a budget the user never stated falls back to rules: the model must not invent or calculate one", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 }), call("run_plan"), reply("Ricalcolo il piano.")]));
  const result = await runAgent([user("raddoppia il budget")], stateWith());
  assert.equal(result.mode, "rules");
  assert.ok(!result.actions.some((action) => action.tool === "set_budget"));
});

for (const [said, value] of [
  ["ho 200.000 euro", 200000],
  ["ho 200k", 200000],
  ["ho 80 mila euro", 80000],
  ["ho 1,5 milioni", 1500000],
  ["ho un milione", 1000000],
  ["ho mezzo milione", 500000],
  ["ho duecentomila euro", 200000],
] as const) {
  test(`a budget the user wrote stays in llm mode: "${said}"`, async () => {
    fakeClient(message([call("set_budget", { budget_eur: value }), call("run_plan"), reply("Ricalcolo il piano.")]));
    const result = await runAgent([user(said)], stateWith());
    assert.equal(result.mode, "llm");
    assert.deepEqual(result.actions[0], { tool: "set_budget", args: { budget_eur: value } });
  });
}

test("a budget from an earlier user turn or from the state is allowed", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 }), call("run_plan"), reply("Ricalcolo il piano.")]));
  const earlier = await runAgent([user("ho 200k"), { role: "assistant", content: "Fatto." }, user("confermo")], stateWith());
  assert.equal(earlier.mode, "llm");
  const fromState = await runAgent([user("confermo il budget")], stateWith({ budget_eur: 200000 }));
  assert.equal(fromState.mode, "llm");
});

test("a minimum of over 75 the user never stated falls back to rules", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 }), call("filter_zones", { min_over75: 700 }), call("run_plan"), reply("Ricalcolo il piano.")]));
  const invented = await runAgent([user("ho 200k per gli over 75 soli")], stateWith());
  assert.equal(invented.mode, "rules");

  fakeClient(message([call("set_budget", { budget_eur: 200000 }), call("filter_zones", { min_over75: 500 }), call("run_plan"), reply("Ricalcolo il piano.")]));
  const stated = await runAgent([user("ho 200k e servono almeno 500 over 75")], stateWith());
  assert.equal(stated.mode, "llm");
});

test("valid tool calls give mode llm in canonical order", async () => {
  fakeClient(
    message([
      reply("Ho impostato 200.000 euro: ricalcolo il piano."),
      call("run_plan"),
      call("filter_zones", { exclude_funded: true }),
      call("set_weights", weights),
      call("set_budget", { budget_eur: 200000 }),
      call("set_profile", { profile: "institution" }),
    ]),
  );
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.deepEqual(
    result.actions.map((action) => action.tool),
    ["set_profile", "set_budget", "set_weights", "filter_zones", "run_plan"],
  );
  assert.equal(result.reply, "Ho impostato 200.000 euro: ricalcolo il piano.");
  assert.equal(result.needs_clarification, false);
});

test("rispondi is never in actions, and a leading thinking block does not matter", async () => {
  fakeClient(message([{ type: "thinking", thinking: "nota", signature: "x" }, call("run_plan"), reply("Ricalcolo il piano.")]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.deepEqual(result.actions, [{ tool: "run_plan", args: {} }]);
  assert.equal(result.reply, "Ricalcolo il piano.");
});

test("tool names match case-insensitively", async () => {
  fakeClient(message([call("SET_Budget", { budget_eur: 200000 }), call("RISPONDI", { reply: "Ricalcolo il piano.", needs_clarification: false })]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.deepEqual(result.actions, [
    { tool: "set_budget", args: { budget_eur: 200000 } },
    { tool: "run_plan", args: {} },
  ]);
  assert.equal(result.reply, "Ricalcolo il piano.");
});

for (const [name, input] of [
  ["set_budget", { budget_eur: "tanti" }],
  ["set_profile", { profile: "banca" }],
  ["filter_zones", {}],
  ["invented_tool", {}],
] as const) {
  test(`invalid action ${name} falls back to rules`, async () => {
    fakeClient(message([call("run_plan"), call(name, input), reply("Fatto.")]));
    const result = await runAgent(budgetAsk, stateWith());
    assert.equal(result.mode, "rules");
    assert.ok(!result.actions.some((action) => (action.tool as string) === "invented_tool"));
  });
}

test("API error falls back to rules", async () => {
  fakeClient(async () => {
    throw new Error("500 boom");
  });
  assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
});

test("a client that throws synchronously falls back to rules", async () => {
  fakeClient(() => {
    throw new Error("sync boom");
  });
  assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
});

test("a hung client falls back within the timeout and is aborted", async () => {
  const { options } = fakeClient(() => new Promise(() => {}));
  const started = Date.now();
  const result = await runAgent(budgetAsk, stateWith(), { timeoutMs: 50 });
  assert.equal(result.mode, "rules");
  assert.ok(Date.now() - started < 1000);
  assert.equal((options[0]?.signal as AbortSignal).aborted, true);
});

for (const stop of ["refusal", "max_tokens", "pause_turn"]) {
  test(`stop_reason ${stop} falls back to rules even with usable content`, async () => {
    fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")], stop));
    assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
  });
}

test("no client gives rules", async () => {
  setClientForTests(null);
  assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
});

test("empty messages, or no user turn, give rules without a request", async () => {
  const { sent } = fakeClient(message([reply("Ciao.")]));
  assert.equal((await runAgent([], stateWith())).mode, "rules");
  assert.equal((await runAgent([{ role: "assistant", content: "Ciao" }], stateWith())).mode, "rules");
  assert.equal(sent.length, 0);
});

test("no action and no reply falls back to rules", async () => {
  fakeClient(message([{ type: "thinking", thinking: "nota", signature: "x" }], "end_turn"));
  assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
});

test("a text-only question gives needs_clarification", async () => {
  fakeClient(message([{ type: "text", text: "Quale budget vuoi destinare? " }], "end_turn"));
  const result = await runAgent([user("aiuto")], stateWith());
  assert.equal(result.mode, "llm");
  assert.equal(result.needs_clarification, true);
  assert.equal(result.reply, "Quale budget vuoi destinare?");
  assert.deepEqual(result.actions, []);
});

test("a text-only statement is not a question", async () => {
  fakeClient(message([{ type: "text", text: "Bussola indica dove investire." }], "end_turn"));
  const result = await runAgent([user("cosa fai")], stateWith());
  assert.equal(result.mode, "llm");
  assert.equal(result.needs_clarification, false);
});

test("missing rispondi and text gives a deterministic Italian reply", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 })]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.equal(result.reply, "Fatto: budget di 200.000 euro, piano in ricalcolo.");
});

test("an invented number in the reply is replaced, keeping actions and mode", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 }), reply("Raggiungerai 4.321 persone.")]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.equal(result.reply, "Fatto: budget di 200.000 euro, piano in ricalcolo.");
  assert.equal(result.actions.length, 2);
});

test("numbers from the user or the state are kept", async () => {
  fakeClient(message([call("run_plan"), reply("Ricalcolo con 200.000 euro.")]));
  assert.equal((await runAgent(budgetAsk, stateWith())).reply, "Ricalcolo con 200.000 euro.");
});

test("SROI in the reply is replaced", async () => {
  fakeClient(message([call("run_plan"), reply("Lo SROI è il migliore.")]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.equal(result.reply, "Fatto: piano in ricalcolo.");
});

test("every deterministic reply passes the number check", async () => {
  fakeClient(
    message([
      call("set_profile", { profile: "third_sector" }),
      call("set_budget", { budget_eur: 1234567 }),
      call("set_weights", weights),
      call("filter_zones", { circ: [3] }),
      call("select_zone", { zone_id: 12 }),
      call("write_memo"),
    ]),
  );
  const messages = [user("1234567 euro, zona 12")];
  const result = await runAgent(messages, stateWith());
  assert.equal(result.mode, "llm");
  assert.deepEqual(findUnsupportedNumbers(result.reply, { messages, state: stateWith(), actions: result.actions }), []);
  assert.ok(result.reply.includes("1.234.567"));
});

test("an invented select_zone is dropped and the reply about it is replaced", async () => {
  fakeClient(message([call("set_budget", { budget_eur: 200000 }), call("select_zone", { zone_id: 999 }), reply("Ho aperto Barriera di Milano.")]));
  const result = await runAgent(budgetAsk, stateWith());
  assert.equal(result.mode, "llm");
  assert.deepEqual(
    result.actions.map((action) => action.tool),
    ["set_budget", "run_plan"],
  );
  assert.ok(!result.reply.includes("Barriera"));
});

test("an invented select_zone alone falls back to rules", async () => {
  fakeClient(message([call("select_zone", { zone_id: 999 }), reply("Ho aperto la zona.")]));
  assert.equal((await runAgent([user("apri la zona migliore")], stateWith())).mode, "rules");
});

test("select_zone is kept for a zone in the plan or a number the user wrote", async () => {
  fakeClient(message([call("select_zone", { zone_id: 7 }), reply("Apro la zona.")]));
  const inPlan = await runAgent([user("apri la prima")], stateWith({ plan: [planItem(7)] }));
  assert.deepEqual(inPlan.actions, [{ tool: "select_zone", args: { zone_id: 7 } }]);
  const typed = await runAgent([user("apri la zona 7")], stateWith());
  assert.deepEqual(typed.actions, [{ tool: "select_zone", args: { zone_id: 7 } }]);
});

test("the over 75 label is not a zone number the user wrote", async () => {
  fakeClient(message([call("select_zone", { zone_id: 75 }), reply("Apro la zona.")]));
  assert.equal((await runAgent([user("priorità agli over 75")], stateWith())).mode, "rules");
});

test("changed settings without run_plan get one, unless a question is open", async () => {
  fakeClient(message([call("run_plan"), call("set_weights", weights), reply("Quale budget vuoi destinare?", true)]));
  const asked = await runAgent([user("anziani soli")], stateWith());
  assert.equal(asked.needs_clarification, true);
  assert.deepEqual(
    asked.actions.map((action) => action.tool),
    ["set_weights"],
  );
  fakeClient(message([call("set_weights", weights), reply("Ricalcolo il piano.")]));
  const answered = await runAgent(budgetAsk, stateWith());
  assert.deepEqual(
    answered.actions.map((action) => action.tool),
    ["set_weights", "run_plan"],
  );
});

test("select_zone alone does not trigger run_plan", async () => {
  fakeClient(message([call("select_zone", { zone_id: 7 }), reply("Apro la zona.")]));
  const result = await runAgent([user("apri la 7")], stateWith({ plan: [planItem(7)] }));
  assert.deepEqual(
    result.actions.map((action) => action.tool),
    ["select_zone"],
  );
});

test("write_memo with an empty plan gets run_plan before it", async () => {
  fakeClient(message([call("write_memo"), reply("Preparo il memo.")]));
  const empty = await runAgent([user("scrivi il memo")], stateWith());
  assert.deepEqual(
    empty.actions.map((action) => action.tool),
    ["run_plan", "write_memo"],
  );
  const full = await runAgent([user("scrivi il memo")], stateWith({ plan: [planItem(7)] }));
  assert.deepEqual(
    full.actions.map((action) => action.tool),
    ["write_memo"],
  );
});

test("an open question with an empty plan removes write_memo rather than running the plan", async () => {
  fakeClient(message([call("write_memo"), reply("Quale budget vuoi destinare?", true)]));
  const result = await runAgent([user("scrivi il memo")], stateWith());
  assert.equal(result.needs_clarification, true);
  assert.deepEqual(result.actions, []);
  assert.equal(result.mode, "llm");
});

test("a replaced reply stays a question when a question is open", async () => {
  fakeClient(message([call("set_weights", weights), reply("Bastano 4.321 euro?", true)]));
  const result = await runAgent([user("anziani soli")], stateWith());
  assert.equal(result.needs_clarification, true);
  assert.ok(result.reply.endsWith("?"));
  assert.ok(!result.reply.includes("4.321"));
});

test("duplicate calls collapse", async () => {
  fakeClient(message([call("run_plan"), call("run_plan"), reply("Ricalcolo il piano.")]));
  assert.equal((await runAgent(budgetAsk, stateWith())).actions.length, 1);
});

test("the request body has exactly the agreed params and no forbidden ones", async () => {
  const { sent, options } = fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  await runAgent(budgetAsk, stateWith());
  const body = sent[0] as SentRequest;
  assert.equal(body.model, modelName());
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.fallbacks, "default");
  assert.equal(body.max_tokens, 1500);
  assert.deepEqual(body.thinking, { type: "between_tools" });
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.deepEqual(body.tool_choice, { type: "auto" });
  assert.deepEqual(body.system, [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(Object.keys(body).sort(), [
    "betas",
    "fallbacks",
    "max_tokens",
    "messages",
    "model",
    "output_config",
    "system",
    "thinking",
    "tool_choice",
    "tools",
  ]);
  assert.equal(options[0]?.timeout, AGENT_TIMEOUT_MS);
  assert.equal(options[0]?.maxRetries, 0);
  assert.ok(options[0]?.signal instanceof AbortSignal);
});

test("tools are strict, closed, free of numeric constraints, and rispondi is the eighth", () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    [...TOOL_NAMES, "rispondi"],
  );
  for (const tool of TOOLS) {
    assert.equal(tool.strict, true);
    assert.equal(tool.input_schema.additionalProperties, false);
    assert.equal(tool.input_schema.type, "object");
    assert.ok(Array.isArray(tool.input_schema.required));
    assert.ok(!/"(minimum|maximum|minItems|maxItems)"/.test(JSON.stringify(tool)));
  }
  assert.deepEqual(TOOLS.find((tool) => tool.name === "filter_zones")?.input_schema.required, []);
});

test("the system prompt and tools do not change between calls", async () => {
  const { sent } = fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  await runAgent(budgetAsk, stateWith());
  await runAgent([user("ho 900.000 euro")], stateWith({ profile: "institution", budget_eur: 900000, plan: [planItem(7)] }));
  assert.equal(sent.length, 2);
  assert.equal(JSON.stringify(sent[0]?.system), JSON.stringify(sent[1]?.system));
  assert.equal(JSON.stringify(sent[0]?.tools), JSON.stringify(sent[1]?.tools));
  assert.ok(!SYSTEM_PROMPT.includes("900000"));
});

test("the system prompt carries the non-negotiables and renders the presets", () => {
  for (const phrase of ["indice di ritorno atteso", "SROI", "ipotesi del team", "stime", "accesso e di lingua", "rispondi", "budget_noto"]) {
    assert.ok(SYSTEM_PROMPT.includes(phrase), phrase);
  }
  for (const preset of ['"isolation":0.35', '"service_gap":0.45', '"inclusion":0.6', "bando", "copertura", "difendibilità"]) {
    assert.ok(SYSTEM_PROMPT.includes(preset), preset);
  }
});

test("state and budget_noto go in the last user message, before the user's words", async () => {
  const { sent } = fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  const state = stateWith({ budget_eur: 300000 });
  await runAgent(
    [user("prima"), { role: "assistant", content: "ok" }, user("ultima parola")],
    state,
  );
  const messages = sent[0]?.messages ?? [];
  assert.deepEqual(messages.slice(0, 2), [
    { role: "user", content: "prima" },
    { role: "assistant", content: "ok" },
  ]);
  const last = messages[2]?.content as Array<{ type: string; text: string }>;
  assert.equal(messages[2]?.role, "user");
  assert.equal(last.length, 2);
  assert.ok(last[0]?.text.includes(JSON.stringify(state)));
  assert.ok(last[0]?.text.endsWith("budget_noto: true"));
  assert.equal(last[1]?.text, "ultima parola");

  await runAgent([user("aiuto")], stateWith());
  const unknown = sent[1]?.messages[0]?.content as Array<{ text: string }>;
  assert.ok(unknown[0]?.text.endsWith("budget_noto: false"));
});

test("history keeps at most 12 turns, starts with user and ends with user", async () => {
  const { sent } = fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  const long: ChatMessage[] = [];
  for (let i = 0; i < 20; i += 1) {
    long.push(user(`u${i}`), { role: "assistant", content: `a${i}` });
  }
  await runAgent(long, stateWith());
  const messages = sent[0]?.messages ?? [];
  assert.ok(messages.length <= 12);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[messages.length - 1]?.role, "user");
  const last = messages[messages.length - 1]?.content as Array<{ text: string }>;
  assert.equal(last[1]?.text, "u19");
});

test("runAgent does not change the caller's messages", async () => {
  fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  const messages: ChatMessage[] = [user("ciao"), { role: "assistant", content: "ok" }];
  await runAgent(messages, stateWith());
  assert.equal(messages.length, 2);
});

test("warmUp is a no-op without a client", async () => {
  setClientForTests(null);
  await warmUp();
});

test("warmUp sends one small request per client, same tools and system, and swallows errors", async () => {
  const good = fakeClient(message([reply("ok")]));
  await warmUp();
  await warmUp();
  assert.equal(good.warmUps.length, 1);
  const request = good.warmUps[0] as SentRequest;
  assert.equal(JSON.stringify(request.tools), JSON.stringify(TOOLS));
  assert.deepEqual(request.system, [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  assert.ok(request.max_tokens < 1500);

  const bad = fakeClient(async () => {
    throw new Error("key rejected");
  });
  await warmUp();
  assert.equal(bad.warmUps.length, 1);
});

test("the first runAgent with a client warms up once, without waiting for it", async () => {
  const { warmUps, sent } = fakeClient(message([call("run_plan"), reply("Ricalcolo il piano.")]));
  await runAgent(budgetAsk, stateWith());
  await runAgent(budgetAsk, stateWith());
  assert.equal(warmUps.length, 1);
  assert.equal(sent.length, 2);
});

test("a hung warm-up does not delay the real answer", async () => {
  let calls = 0;
  fakeClient(() => {
    calls += 1;
    return calls === 1 ? new Promise(() => {}) : { content: [reply("Ricalcolo il piano.")], stop_reason: "tool_use" };
  });
  const result = await runAgent(budgetAsk, stateWith(), { timeoutMs: 200 });
  assert.equal(result.mode, "llm");
});

/** The real SDK against a local server: no key and no network to Anthropic, so this proves the wire format only. */
async function withLocalApi(
  handler: (body: Record<string, unknown>, headers: IncomingHttpHeaders, res: ServerResponse) => void,
  run: (client: Anthropic) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => handler(JSON.parse(raw) as Record<string, unknown>, req.headers, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(new AnthropicSdk({ apiKey: "test-only", baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 }));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the real SDK sends the agreed request on the wire and its response is read", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const betaHeaders: unknown[] = [];
  await withLocalApi(
    (body, headers, res) => {
      bodies.push(body);
      betaHeaders.push(headers["anthropic-beta"]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            { type: "thinking", thinking: "nota", signature: "x" },
            { type: "tool_use", id: "t1", name: "set_budget", input: { budget_eur: 200000 } },
            { type: "tool_use", id: "t2", name: "rispondi", input: { reply: "Ricalcolo il piano.", needs_clarification: false } },
          ],
        }),
      );
    },
    async (client) => {
      setClientForTests(client);
      const result = await runAgent(budgetAsk, stateWith());
      assert.equal(result.mode, "llm");
      assert.deepEqual(result.actions, [
        { tool: "set_budget", args: { budget_eur: 200000 } },
        { tool: "run_plan", args: {} },
      ]);
    },
  );
  const body = bodies.find((candidate) => candidate.max_tokens === 1500) as Record<string, unknown>;
  assert.deepEqual(body.thinking, { type: "between_tools" });
  assert.deepEqual(body.tool_choice, { type: "auto" });
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.fallbacks, "default");
  assert.ok(!("betas" in body), "betas travels as a header");
  assert.ok(betaHeaders.every((value) => String(value).includes("server-side-fallback-2026-07-01")));
  for (const forbidden of ["temperature", "top_p", "top_k"]) assert.ok(!(forbidden in body), forbidden);
});

test("the real SDK falls back on a hung server, an HTTP 400 and a rejected key", async () => {
  await withLocalApi(
    () => {},
    async (client) => {
      setClientForTests(client);
      const started = Date.now();
      const result = await runAgent(budgetAsk, stateWith(), { timeoutMs: 100 });
      assert.equal(result.mode, "rules");
      assert.ok(Date.now() - started < 1000);
    },
  );
  for (const status of [400, 401, 529]) {
    await withLocalApi(
      (_body, _headers, res) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "no" } }));
      },
      async (client) => {
        setClientForTests(client);
        assert.equal((await runAgent(budgetAsk, stateWith())).mode, "rules");
      },
    );
  }
});
