import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ACTIONS, MAX_BUDGET_EUR, MIN_BUDGET_EUR } from "../src/contract.js";
import { normalizeMessages, normalizeState, validateAction, validateActions } from "../src/validate.js";

test("set_budget clamps to the allowed range and rounds", () => {
  assert.deepEqual(validateAction({ tool: "set_budget", args: { budget_eur: 1e12 } }), {
    tool: "set_budget",
    args: { budget_eur: MAX_BUDGET_EUR },
  });
  assert.deepEqual(validateAction({ tool: "set_budget", args: { budget_eur: 5 } }), {
    tool: "set_budget",
    args: { budget_eur: MIN_BUDGET_EUR },
  });
  assert.deepEqual(validateAction({ tool: "set_budget", args: { budget_eur: 12345.6 } }), {
    tool: "set_budget",
    args: { budget_eur: 12346 },
  });
});

test("set_budget rejects non-numbers and non-positive values", () => {
  assert.equal(validateAction({ tool: "set_budget", args: { budget_eur: "200000" } }), null);
  assert.equal(validateAction({ tool: "set_budget", args: { budget_eur: -1 } }), null);
  assert.equal(validateAction({ tool: "set_budget", args: { budget_eur: Number.NaN } }), null);
  assert.equal(validateAction({ tool: "set_budget", args: {} }), null);
});

test("set_weights clamps, normalises to a sum of 1, and needs all four keys", () => {
  const action = validateAction({
    tool: "set_weights",
    args: { isolation: 2, service_gap: 1, future_pressure: 0, inclusion: -3 },
  });
  assert.ok(action && action.tool === "set_weights");
  assert.deepEqual(action.args, { isolation: 0.5, service_gap: 0.5, future_pressure: 0, inclusion: 0 });

  const thirds = validateAction({
    tool: "set_weights",
    args: { isolation: 1, service_gap: 1, future_pressure: 1, inclusion: 0 },
  });
  assert.ok(thirds && thirds.tool === "set_weights");
  const sum = Object.values(thirds.args).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum was ${sum}`);

  assert.equal(validateAction({ tool: "set_weights", args: { isolation: 1 } }), null);
  assert.equal(
    validateAction({ tool: "set_weights", args: { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 } }),
    null,
  );
});

test("filter_zones keeps valid parts and never turns bad circoscrizioni into no filter", () => {
  assert.deepEqual(validateAction({ tool: "filter_zones", args: { circ: [6, 3, 3, 9, 2.5] } }), {
    tool: "filter_zones",
    args: { circ: [3, 6] },
  });
  assert.equal(validateAction({ tool: "filter_zones", args: { circ: [9, 0] } }), null);
  assert.deepEqual(validateAction({ tool: "filter_zones", args: { circ: [] } }), {
    tool: "filter_zones",
    args: { circ: [] },
  });
  assert.deepEqual(validateAction({ tool: "filter_zones", args: { exclude_funded: true, min_over75: -4 } }), {
    tool: "filter_zones",
    args: { exclude_funded: true, min_over75: 0 },
  });
  assert.equal(validateAction({ tool: "filter_zones", args: {} }), null);
  assert.equal(validateAction({ tool: "filter_zones", args: { exclude_funded: "si" } }), null);
});

test("other tools", () => {
  assert.deepEqual(validateAction({ tool: "set_profile", args: { profile: "institution" } }), {
    tool: "set_profile",
    args: { profile: "institution" },
  });
  assert.equal(validateAction({ tool: "set_profile", args: { profile: "banca" } }), null);
  assert.deepEqual(validateAction({ tool: "run_plan" }), { tool: "run_plan", args: {} });
  assert.deepEqual(validateAction({ tool: "write_memo", args: { extra: 1 } }), { tool: "write_memo", args: {} });
  assert.deepEqual(validateAction({ tool: "select_zone", args: { zone_id: 70 } }), {
    tool: "select_zone",
    args: { zone_id: 70 },
  });
  assert.equal(validateAction({ tool: "select_zone", args: { zone_id: 7.5 } }), null);
  assert.equal(validateAction({ tool: "select_zone", args: { zone_id: "70" } }), null);
  assert.equal(validateAction({ tool: "delete_everything", args: {} }), null);
  assert.equal(validateAction("run_plan"), null);
  assert.equal(validateAction(null), null);
});

test("validateActions counts what it drops and caps the list", () => {
  const { actions, dropped } = validateActions([{ tool: "run_plan" }, { tool: "nope" }, 7]);
  assert.equal(actions.length, 1);
  assert.equal(dropped, 2);
  const many = validateActions(Array.from({ length: MAX_ACTIONS + 3 }, () => ({ tool: "run_plan" })));
  assert.equal(many.actions.length, MAX_ACTIONS);
  assert.equal(many.dropped, 3);
  assert.deepEqual(validateActions("x"), { actions: [], dropped: 0 });
});

test("normalizeState fills gaps from the contract defaults", () => {
  const state = normalizeState({ budget_eur: 5000, filters: { circ: [3, 11] }, profile: "banca", plan: "x" });
  assert.equal(state.budget_eur, 5000);
  assert.equal(state.profile, "foundation");
  assert.deepEqual(state.filters, { circ: [3], exclude_funded: false, min_over75: 0 });
  assert.deepEqual(state.plan, []);
  assert.equal(state.selected_zone_id, null);
  assert.equal(normalizeState(null).budget_eur, 100000);
});

test("normalizeMessages drops malformed turns", () => {
  assert.deepEqual(
    normalizeMessages([
      { role: "system", content: "x" },
      { role: "user", content: "  " },
      { role: "user", content: "ciao" },
      "x",
    ]),
    [{ role: "user", content: "ciao" }],
  );
  assert.deepEqual(normalizeMessages(undefined), []);
});
