/**
 * Runs the demo prompts in test-prompts.json, prints the actions and checks them.
 *
 *   npm run prompts                      POST to http://localhost:8787/api/agent
 *   npm run prompts -- --url <url>       use another endpoint (or set BUSSOLA_URL)
 *   npm run prompts -- --direct          no server, call runRules in-process
 *   npm run prompts -- --json <path>     also write all raw responses to a file
 *
 * Rules mode must match each prompt's "expect" exactly. In LLM mode the model may choose
 * differently, so differences in tools and args are printed as notes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import type { AppState, ChatMessage, PlanItem } from "../src/contract.js";
import { runRules } from "../src/rules.js";
import { validateActions } from "../src/validate.js";

const DEFAULT_URL = "http://localhost:8787/api/agent";
const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROMPTS_PATH = fileURLToPath(new URL("../test-prompts.json", import.meta.url));
const USAGE = "Usage: npm run prompts -- [--direct] [--url <url>] [--json <path>]";

interface Expect {
  tools: string[];
  needs_clarification: boolean;
  args?: Record<string, Record<string, unknown>>;
}

interface PromptCase {
  id: string;
  prompt: string;
  history?: ChatMessage[];
  use_mock_plan?: boolean;
  expect: Expect;
}

interface PromptsFile {
  mock_state: AppState;
  mock_plan: PlanItem[];
  prompts: PromptCase[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message} (${detail})` : error.message;
}

/** Accepts a full endpoint or a bare origin such as http://localhost:8787. */
function endpointFrom(raw: string): string {
  const url = new URL(raw);
  if (url.pathname === "/") url.pathname = "/api/agent";
  return url.href;
}

/** Any HTTP answer, even a 404, means something is listening at that address. */
async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function askServer(url: string, messages: ChatMessage[], state: AppState): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, state }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.json();
}

/** Differences from the pinned tools and args. Failures in rules mode, notes in LLM mode. */
function expectDifferences(actions: unknown[], expect: Expect): string[] {
  const differences: string[] = [];
  const tools = actions.map((action) => (isRecord(action) ? action.tool : action));
  if (!isDeepStrictEqual(tools, expect.tools)) {
    differences.push(`tools are ${JSON.stringify(tools)}, expected ${JSON.stringify(expect.tools)}`);
  }
  for (const [tool, subset] of Object.entries(expect.args ?? {})) {
    const action = actions.find((item) => isRecord(item) && item.tool === tool);
    if (!isRecord(action)) {
      differences.push(`no ${tool} action, expected args ${JSON.stringify(subset)}`);
      continue;
    }
    const args = isRecord(action.args) ? action.args : {};
    for (const [key, value] of Object.entries(subset)) {
      if (!isDeepStrictEqual(args[key], value)) {
        differences.push(`${tool}.${key} is ${JSON.stringify(args[key])}, expected ${JSON.stringify(value)}`);
      }
    }
  }
  return differences;
}

function checkResponse(response: Record<string, unknown>, expect: Expect): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  let notes: string[] = [];
  const { reply, actions, needs_clarification: needsClarification, mode } = response;

  if (typeof reply !== "string" || reply.trim() === "") failures.push("reply is not a non-empty string");
  if (typeof reply === "string" && /sroi/i.test(reply)) failures.push('reply contains "SROI"');
  if (mode !== "llm" && mode !== "rules") failures.push(`mode is ${JSON.stringify(mode)}, expected "llm" or "rules"`);
  if (needsClarification !== expect.needs_clarification) {
    failures.push(
      `needs_clarification is ${JSON.stringify(needsClarification)}, expected ${expect.needs_clarification}`,
    );
  }

  if (!Array.isArray(actions)) {
    failures.push("actions is not an array");
    return { failures, notes };
  }
  const validated = validateActions(actions);
  if (validated.dropped !== 0) failures.push(`validateActions dropped ${validated.dropped} action(s)`);
  if (validated.actions.length !== actions.length) {
    failures.push(`validateActions returned ${validated.actions.length} of ${actions.length} action(s)`);
  }

  const differences = expectDifferences(actions, expect);
  if (mode === "rules") failures.push(...differences);
  else notes = differences;
  return { failures, notes };
}

function printResponse(response: Record<string, unknown>): void {
  const { reply, actions, needs_clarification: needsClarification, mode } = response;
  const replyText = typeof reply === "string" ? reply.replace(/\r?\n/g, "\n       ") : JSON.stringify(reply);
  console.log(`mode: ${String(mode)}`);
  console.log(`needs_clarification: ${String(needsClarification)}`);
  console.log(`reply: ${replyText}`);
  if (!Array.isArray(actions)) return;
  console.log(`actions: ${actions.length}`);
  for (const action of actions) {
    if (isRecord(action)) console.log(`  ${String(action.tool)} ${JSON.stringify(action.args ?? {})}`);
    else console.log(`  (malformed) ${JSON.stringify(action)}`);
  }
}

function parseCli() {
  return parseArgs({
    options: { direct: { type: "boolean" }, url: { type: "string" }, json: { type: "string" } },
  }).values;
}

async function main(): Promise<number> {
  let options: ReturnType<typeof parseCli>;
  let url: string | null = null;
  try {
    options = parseCli();
    if (!options.direct) url = endpointFrom(options.url || process.env.BUSSOLA_URL || DEFAULT_URL);
  } catch (error) {
    console.error(describeError(error));
    console.error(USAGE);
    return 1;
  }

  if (url && !(await isReachable(url))) {
    console.error(`Cannot reach the Bussola server at ${url}`);
    console.error('Start it in another terminal with "npm run dev", or run without a server:');
    console.error("  npm run prompts -- --direct");
    return 1;
  }

  const file = JSON.parse(readFileSync(PROMPTS_PATH, "utf8")) as PromptsFile;
  console.log(`Target: ${url ?? "runRules in-process (--direct)"}`);

  const rawResponses: unknown[] = [];
  const failedIds: string[] = [];

  for (const item of file.prompts) {
    const messages: ChatMessage[] = [...(item.history ?? []), { role: "user", content: item.prompt }];
    const state = structuredClone(item.use_mock_plan ? { ...file.mock_state, plan: file.mock_plan } : file.mock_state);

    console.log("");
    console.log(`==== ${item.id} ====`);
    console.log(`prompt: ${item.prompt}`);

    let failures: string[] = [];
    let notes: string[] = [];
    try {
      const response: unknown = url ? await askServer(url, messages, state) : runRules(messages, state);
      rawResponses.push({ id: item.id, prompt: item.prompt, response });
      if (isRecord(response)) {
        printResponse(response);
        ({ failures, notes } = checkResponse(response, item.expect));
      } else {
        failures = [`response is not a JSON object: ${JSON.stringify(response)}`];
      }
    } catch (error) {
      const message = describeError(error);
      rawResponses.push({ id: item.id, prompt: item.prompt, error: message });
      failures = [`request failed: ${message}`];
    }

    for (const note of notes) console.log(`note: ${note}`);
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    console.log(`result: ${failures.length === 0 ? "PASS" : "FAIL"}`);
    if (failures.length > 0) failedIds.push(item.id);
  }

  console.log("");
  let jsonFailed = false;
  if (options.json) {
    const outPath = path.resolve(options.json);
    try {
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(rawResponses, null, 2)}\n`, "utf8");
      console.log(`Raw responses written to ${outPath}`);
    } catch (error) {
      jsonFailed = true;
      console.log(`Could not write ${outPath}: ${describeError(error)}`);
    }
  }
  if (failedIds.length > 0) console.log(`Failed: ${failedIds.join(", ")}`);
  console.log(`PASS ${file.prompts.length - failedIds.length}/${file.prompts.length}`);
  return failedIds.length > 0 || jsonFailed ? 1 : 0;
}

// exitCode rather than process.exit(): on Windows stdout writes are asynchronous and could be cut off.
process.exitCode = await main();
