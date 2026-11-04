/**
 * Turns the chat into planner actions with one LLM call, and falls back to rules mode whenever
 * that output cannot be used. There is no agentic loop because the browser applies the actions.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_TIMEOUT_MS, MAX_ACTIONS, TOOL_NAMES } from "./contract.js";
import type { Action, AgentResponse, AppState, ChatMessage, ToolName } from "./contract.js";
import { getClient, modelName, noteLlmError } from "./llm.js";
import { extractNumbers, findUnsupportedNumbers } from "./numbers.js";
import { PROFILE_LABEL } from "./profiles.js";
import { REPLY_TOOL, SYSTEM_PROMPT, TOOLS } from "./prompts.js";
import { budgetKnown, isRelativeBudgetChange, runRules } from "./rules.js";
import { lastUserText, validateActions } from "./validate.js";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const MAX_TOKENS = 1500;
const MAX_TURNS = 12;
const WARM_UP_TIMEOUT_MS = 30_000;
const WARM_UP_MAX_TOKENS = 32;

/** Any other stop reason means the content cannot be trusted as complete. */
const USABLE_STOP_REASONS = new Set(["end_turn", "tool_use", "stop_sequence"]);

const SETTING_TOOLS = new Set<ToolName>(["set_profile", "set_budget", "set_weights", "filter_zones"]);

function createMessage(
  client: Anthropic,
  messages: BetaMessageParam[],
  maxTokens: number,
  timeoutMs: number,
  signal: AbortSignal,
): PromiseLike<BetaMessage> {
  return client.beta.messages.create(
    {
      model: modelName(),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: maxTokens,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      tool_choice: { type: "auto" },
      tools: TOOLS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    },
    { timeout: timeoutMs, maxRetries: 0, signal },
  );
}

/** Settles by the deadline even if the work ignores its abort signal. */
async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => PromiseLike<T>,
  background = false,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    // A background warm-up must not keep the process alive. A request in progress must.
    if (background) timer.unref();
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** History as plain text, ready for the API. Empty when there is no user turn to answer. */
function toApiMessages(messages: ChatMessage[], state: AppState): BetaMessageParam[] {
  const turns = messages.filter((message) => message.content.trim() !== "");
  // A trailing assistant turn would be a prefill, which the model rejects.
  while (turns.length > 0 && turns[turns.length - 1]?.role !== "user") turns.pop();
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length > 0 && recent[0]?.role !== "user") recent.shift();

  const context = `Stato corrente (JSON):\n${JSON.stringify(state)}\nbudget_noto: ${budgetKnown(messages, state)}`;
  return recent.map((message, index) =>
    index === recent.length - 1
      ? {
          role: "user",
          content: [
            { type: "text", text: context },
            { type: "text", text: message.content },
          ],
        }
      : { role: message.role, content: message.content },
  );
}

interface ModelOutput {
  rawActions: Array<{ tool: string; args: unknown }>;
  reply: string;
  needsClarification: boolean;
}

const LEAKED_CALL = new RegExp(
  String.raw`\x60\x60\x60|</?(?:thinking|function_calls|invoke|parameter|tool_use)\b|^\s*[{[]|"(?:tool|args)"\s*:|\b(?:${[...TOOL_NAMES, REPLY_TOOL].join("|")})\b`,
  "im",
);

/**
 * Text for the user, or "" if it is really a tool call or internal markup written as prose.
 * Actions only ever come from native tool_use blocks: a call written as text is never executed.
 */
function usableReply(raw: string): string {
  const text = raw.replace(/<thinking\b[^>]*>[\s\S]*?(?:<\/thinking>|$)/gi, " ").trim();
  return LEAKED_CALL.test(text) ? "" : text;
}

/** Reads blocks by type, never by position: a response may begin with thinking blocks. */
function readContent(content: BetaMessage["content"]): ModelOutput {
  const rawActions: ModelOutput["rawActions"] = [];
  const texts: string[] = [];
  let toolReply = "";
  let toolAskedQuestion = false;

  for (const block of content) {
    if (block.type === "text") {
      texts.push(block.text);
    } else if (block.type === "tool_use") {
      const name = block.name.trim().toLowerCase();
      if (name === REPLY_TOOL) {
        const input = (block.input ?? {}) as { reply?: unknown; needs_clarification?: unknown };
        if (typeof input.reply === "string") toolReply = usableReply(input.reply);
        toolAskedQuestion = input.needs_clarification === true;
      } else {
        rawActions.push({ tool: name, args: block.input });
      }
    }
  }

  if (toolReply !== "") return { rawActions, reply: toolReply, needsClarification: toolAskedQuestion };
  const text = usableReply(texts.join("\n"));
  return { rawActions, reply: text, needsClarification: toolAskedQuestion || text.endsWith("?") };
}

interface ProcessedActions {
  actions: Action[];
  inventedZone: boolean;
}

/** Applies the planner rules to validated actions, whatever the model chose to call. */
function postProcess(
  validated: Action[],
  needsClarification: boolean,
  messages: ChatMessage[],
  state: AppState,
): ProcessedActions {
  const typedNumbers = extractNumbers(lastUserText(messages))
    .filter((token) => !token.percent)
    .map((token) => token.value);
  const seen = new Set<string>();
  let inventedZone = false;
  let actions: Action[] = [];

  for (const action of validated) {
    const key = JSON.stringify(action);
    if (seen.has(key)) continue;
    seen.add(key);
    if (action.tool === "select_zone") {
      const zoneId = action.args.zone_id;
      if (!state.plan.some((item) => item.zone_id === zoneId) && !typedNumbers.includes(zoneId)) {
        inventedZone = true;
        continue;
      }
    }
    actions.push(action);
  }

  const has = (tool: ToolName): boolean => actions.some((action) => action.tool === tool);
  const settingsChanged = actions.some((action) => SETTING_TOOLS.has(action.tool));
  const memoNeedsPlan = has("write_memo") && state.plan.length === 0;

  if (needsClarification) {
    // While a question is open the plan does not run, so a memo would be on an empty or stale plan.
    const dropMemo = memoNeedsPlan || settingsChanged;
    actions = actions.filter((action) => action.tool !== "run_plan" && !(dropMemo && action.tool === "write_memo"));
  } else if ((settingsChanged || memoNeedsPlan) && !has("run_plan")) {
    actions.push({ tool: "run_plan", args: {} });
  }

  // TOOL_NAMES is in canonical order. Array.prototype.sort is stable.
  actions.sort((a, b) => TOOL_NAMES.indexOf(a.tool) - TOOL_NAMES.indexOf(b.tool));
  return { actions, inventedZone };
}

function formatEuro(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Italian reply built only from validated actions, so its figures are always supported. */
function deterministicReply(
  actions: Action[],
  needsClarification: boolean,
  messages: ChatMessage[],
  state: AppState,
): string {
  const done = actions.map((action): string => {
    switch (action.tool) {
      case "set_profile":
        return `profilo impostato su ${PROFILE_LABEL[action.args.profile]}`;
      case "set_budget":
        return `budget di ${formatEuro(action.args.budget_eur)} euro`;
      case "set_weights":
        return "priorità aggiornate";
      case "filter_zones":
        return "filtri aggiornati";
      case "run_plan":
        return "piano in ricalcolo";
      case "select_zone":
        return `zona ${action.args.zone_id} selezionata`;
      case "write_memo":
        return "memo in preparazione";
    }
  });
  const summary = done.length > 0 ? `Fatto: ${done.join(", ")}.` : "";
  if (!needsClarification) return summary;
  const question = budgetKnown(messages, state) ? "Qual è l'obiettivo principale?" : "Quale budget vuoi destinare?";
  return `${summary} ${question}`.trim();
}

function rulesAnswer(messages: ChatMessage[], state: AppState): AgentResponse {
  try {
    return { ...runRules(messages, state), mode: "rules" };
  } catch (error) {
    noteLlmError("agent rules", error);
    return { reply: "Non riesco a elaborare la richiesta. Puoi riformularla?", actions: [], needs_clarification: true, mode: "rules" };
  }
}

/**
 * The model never invents or calculates a figure. A budget or a minimum must be one the user wrote
 * or one already in the state. "Raddoppia il budget" is a calculation, so it goes to rules mode.
 */
function assertFiguresWereStated(actions: Action[], messages: ChatMessage[], state: AppState): void {
  if (actions.some((action) => action.tool === "set_budget") && isRelativeBudgetChange(lastUserText(messages))) {
    throw new Error("relative budget change: the new total must come from the user");
  }
  const said = messages.filter((message) => message.role === "user").map((message) => message.content);
  const stated = (value: number): boolean =>
    findUnsupportedNumbers(String(value), { said, budget: state.budget_eur, minimum: state.filters.min_over75 }).length === 0;
  for (const action of actions) {
    if (action.tool === "set_budget" && !stated(action.args.budget_eur)) {
      throw new Error("budget not stated by the user");
    }
    if (action.tool === "filter_zones" && action.args.min_over75 && !stated(action.args.min_over75)) {
      throw new Error("min_over75 not stated by the user");
    }
  }
}

/** Throws whenever the LLM output cannot be used. The caller falls back to rules mode. */
async function askModel(
  client: Anthropic,
  apiMessages: BetaMessageParam[],
  messages: ChatMessage[],
  state: AppState,
  timeoutMs: number,
): Promise<AgentResponse> {
  const response = await withDeadline(timeoutMs, (signal) =>
    createMessage(client, apiMessages, MAX_TOKENS, timeoutMs, signal),
  );
  if (response.stop_reason && !USABLE_STOP_REASONS.has(response.stop_reason)) {
    throw new Error(`unusable stop_reason ${response.stop_reason}`);
  }

  const { rawActions, reply: modelReply, needsClarification } = readContent(response.content);
  const { actions: validated, dropped } = validateActions(rawActions);
  if (dropped > 0) throw new Error(`${dropped} invalid actions from the model`);
  assertFiguresWereStated(validated, messages, state);

  const { actions, inventedZone } = postProcess(validated, needsClarification, messages, state);
  if (actions.length > MAX_ACTIONS) throw new Error("too many actions from the model");

  // A reply that announced an invented zone is wrong even without a figure in it.
  const replyIsUsable =
    modelReply !== "" &&
    !inventedZone &&
    !/sroi/i.test(modelReply) &&
    findUnsupportedNumbers(modelReply, { messages, state, actions }).length === 0;
  if (replyIsUsable) return { reply: modelReply, actions, needs_clarification: needsClarification, mode: "llm" };

  // With no actions either, nothing from the model would survive, so calling this "llm" would be untrue.
  if (actions.length === 0) throw new Error("no usable action and no usable reply");
  return {
    reply: deterministicReply(actions, needsClarification, messages, state),
    actions,
    needs_clarification: needsClarification,
    mode: "llm",
  };
}

const warmedClients = new WeakSet<object>();

/**
 * Primes the strict-schema and prompt caches and detects a rejected key early.
 * Runs once per client object, so a key added later still warms up. Never rejects.
 */
export async function warmUp(): Promise<void> {
  try {
    const client = getClient();
    if (!client || warmedClients.has(client)) return;
    warmedClients.add(client);
    await withDeadline(
      WARM_UP_TIMEOUT_MS,
      (signal) =>
        createMessage(client, [{ role: "user", content: "ping" }], WARM_UP_MAX_TOKENS, WARM_UP_TIMEOUT_MS, signal),
      true,
    );
  } catch (error) {
    noteLlmError("agent warm-up", error);
  }
}

/** Never rejects. mode is "llm" only when the LLM output was actually used. */
export async function runAgent(
  messages: ChatMessage[],
  state: AppState,
  options: { timeoutMs?: number } = {},
): Promise<AgentResponse> {
  const started = Date.now();
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : AGENT_TIMEOUT_MS;
  let result: AgentResponse;
  try {
    const client = getClient();
    if (client) void warmUp();
    const apiMessages = client ? toApiMessages(messages, state) : [];
    result =
      client && apiMessages.length > 0
        ? await askModel(client, apiMessages, messages, state, timeoutMs)
        : rulesAnswer(messages, state);
  } catch (error) {
    noteLlmError("agent", error);
    result = rulesAnswer(messages, state);
  }
  console.log(`[agent] mode=${result.mode} latency_ms=${Date.now() - started} actions=${result.actions.length}`);
  return result;
}
