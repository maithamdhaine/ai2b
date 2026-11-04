import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_STATE, TOOL_NAMES } from "../src/contract.js";
import type { AppState, ChatMessage, PlanItem } from "../src/contract.js";
import { runRules } from "../src/rules.js";
import { validateAction, validateActions } from "../src/validate.js";

interface PromptCase {
  id: string;
  prompt: string;
  history?: ChatMessage[];
  use_mock_plan?: boolean;
  expect: {
    tools: string[];
    needs_clarification: boolean;
    args?: Record<string, Record<string, unknown>>;
  };
}

interface PromptsFile {
  _note: string;
  mock_state: AppState;
  mock_plan: PlanItem[];
  prompts: PromptCase[];
}

const file = JSON.parse(readFileSync(new URL("../test-prompts.json", import.meta.url), "utf8")) as PromptsFile;

const PLAN_ITEM_KEYS = [
  "budget_eur",
  "circ",
  "confidence",
  "cost_per_person_eur",
  "intervention_id",
  "intervention_label",
  "people_reached",
  "return_index",
  "scores",
  "zone_id",
  "zone_name",
];
const SCORE_KEYS = ["funded_share", "future_pressure", "inclusion", "isolation", "service_gap"];

test("test-prompts.json: mock data follows the contract and is labelled as mock", () => {
  assert.match(file._note, /mock/i);
  assert.deepEqual(file.mock_state, DEFAULT_STATE);
  assert.ok(file.mock_plan.some((item) => item.zone_id === 70 && item.zone_name === "Pilonetto" && item.circ === 8));
  for (const item of file.mock_plan) {
    assert.deepEqual(Object.keys(item).sort(), PLAN_ITEM_KEYS);
    assert.deepEqual(Object.keys(item.scores).sort(), SCORE_KEYS);
    assert.ok(["official", "estimated", "low"].includes(item.confidence));
  }
});

test("test-prompts.json: ten prompts, with expectations the contract allows", () => {
  assert.equal(file.prompts.length, 10);
  assert.equal(new Set(file.prompts.map((item) => item.id)).size, 10);
  for (const item of file.prompts) {
    for (const tool of item.expect.tools) {
      assert.ok((TOOL_NAMES as readonly string[]).includes(tool), `${item.id}: unknown tool ${tool}`);
    }
    for (const [tool, args] of Object.entries(item.expect.args ?? {})) {
      assert.ok(item.expect.tools.includes(tool), `${item.id}: args for ${tool}, which is not expected`);
      // A pinned value the validator would reject or change could never reach the app.
      assert.deepEqual(validateAction({ tool, args }), { tool, args }, `${item.id}: invalid args for ${tool}`);
    }
  }
});

for (const item of file.prompts) {
  test(`${item.id}: ${item.prompt}`, () => {
    const messages: ChatMessage[] = [...(item.history ?? []), { role: "user", content: item.prompt }];
    const state = structuredClone(item.use_mock_plan ? { ...file.mock_state, plan: file.mock_plan } : file.mock_state);

    const response = runRules(messages, state);

    assert.deepEqual(
      response.actions.map((action) => action.tool),
      item.expect.tools,
    );
    assert.equal(response.needs_clarification, item.expect.needs_clarification);
    for (const [tool, subset] of Object.entries(item.expect.args ?? {})) {
      const action = response.actions.find((candidate) => candidate.tool === tool);
      assert.ok(action, `no ${tool} action`);
      const args = action.args as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(subset)) {
        assert.deepEqual(args[key], value, `${tool}.${key}`);
      }
    }

    const validated = validateActions(response.actions);
    assert.equal(validated.dropped, 0);
    assert.equal(validated.actions.length, response.actions.length);

    assert.equal(response.mode, "rules");
    assert.equal(typeof response.reply, "string");
    assert.notEqual(response.reply.trim(), "");
    assert.doesNotMatch(response.reply, /sroi/i);
  });
}
