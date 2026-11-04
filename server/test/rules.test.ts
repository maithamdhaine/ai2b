import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_STATE } from "../src/contract.js";
import type { Action, AppState, ChatMessage, PlanItem, ToolName, Weights } from "../src/contract.js";
import { findUnsupportedNumbers } from "../src/numbers.js";
import { PROFILE_FOCUS, PROFILE_WEIGHTS, weightsFor } from "../src/profiles.js";
import { budgetKnown, parseBudget, runRules } from "../src/rules.js";
import { validateAction } from "../src/validate.js";

function planItem(zoneId: number, zoneName: string, circ: number): PlanItem {
  return {
    zone_id: zoneId,
    zone_name: zoneName,
    circ,
    intervention_id: "mock",
    intervention_label: "Mock",
    budget_eur: 50000,
    people_reached: 120,
    cost_per_person_eur: 416,
    return_index: 1.7,
    scores: { isolation: 0.5, service_gap: 0.5, future_pressure: 0.5, inclusion: 0.5, funded_share: 0.1 },
    confidence: "estimated",
  };
}

const PLAN = [planItem(70, "Pilonetto", 8), planItem(12, "Barriera di Milano", 6), planItem(33, "Lingotto", 8)];

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...structuredClone(DEFAULT_STATE), ...overrides };
}

test('"senza" names the need when the missing thing is a resource', () => {
  for (const said of ["ho 100k per le persone senza lavoro", "ho 100k per i disoccupati over 50"]) {
    const weights = runRules([{ role: "user", content: said }], state()).actions.find((a) => a.tool === "set_weights");
    assert.ok(weights && weights.tool === "set_weights", said);
    assert.ok(weights.args.inclusion > weights.args.isolation, said);
  }
  for (const said of ["ho 100k per le zone senza farmacie", "ho 100k per le zone senza servizi", "ho 100k per le zone scoperte"]) {
    const weights = runRules([{ role: "user", content: said }], state()).actions.find((a) => a.tool === "set_weights");
    assert.ok(weights && weights.tool === "set_weights", said);
    assert.ok(weights.args.service_gap > weights.args.isolation, said);
  }
  const notAboutThem = runRules([{ role: "user", content: "ho 100k, senza gli anziani" }], state());
  assert.ok(!notAboutThem.actions.some((a) => a.tool === "set_weights"));
});

test('"budget di" makes a year-like figure money, without capturing a real year', () => {
  assert.equal(parseBudget("budget di 2000"), 2000);
  assert.equal(parseBudget("un budget pari a 2030"), 2030);
  assert.equal(parseBudget("budget 2026 di 300k"), 300000);
  assert.equal(parseBudget("priorità al 2030"), null);
});

function user(content: string): ChatMessage {
  return { role: "user", content };
}

function ask(text: string, appState: AppState = state()) {
  return runRules([user(text)], appState);
}

function tools(actions: Action[]): ToolName[] {
  return actions.map((action) => action.tool);
}

function argsOf(actions: Action[], tool: ToolName): unknown {
  return actions.find((action) => action.tool === tool)?.args;
}

/** The weights as the app receives them: the validator makes them sum to 1. */
function expectedWeights(weights: Weights): Weights {
  const clean = validateAction({ tool: "set_weights", args: weights });
  assert.ok(clean?.tool === "set_weights");
  return clean.args;
}

// ---------------------------------------------------------------------------
// The ten pinned demo prompts
// ---------------------------------------------------------------------------

test("p01 budget, over 75 goal, exclude funded", () => {
  const r = ask("ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR");
  assert.deepEqual(tools(r.actions), ["set_budget", "set_weights", "filter_zones", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 200000 });
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["isolation"], "foundation")));
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { exclude_funded: true });
  assert.equal(r.needs_clarification, false);
  assert.equal(r.mode, "rules");
  assert.match(r.reply, /200\.000 €/);
});

test("p02 foundation, 500k, service gap", () => {
  const r = ask("Siamo una fondazione bancaria con 500k: dove investiamo per ridurre la carenza di servizi?");
  assert.deepEqual(tools(r.actions), ["set_profile", "set_budget", "set_weights", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_profile"), { profile: "foundation" });
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 500000 });
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["service_gap"], "foundation")));
  assert.equal(r.needs_clarification, false);
});

test("p03 third sector, 80 mila, inclusion", () => {
  const r = ask("Terzo settore, abbiamo 80 mila euro per l'inclusione lavorativa degli over 50");
  assert.deepEqual(tools(r.actions), ["set_profile", "set_budget", "set_weights", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_profile"), { profile: "third_sector" });
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 80000 });
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["inclusion"], "third_sector")));
});

test("p04 institution, 1,5 milioni, circoscrizioni, overlap", () => {
  const r = ask("Come assessorato abbiamo 1,5 milioni, concentrati sulle circoscrizioni 5 e 6 ed evita sovrapposizioni con il PNRR");
  assert.deepEqual(tools(r.actions), ["set_profile", "set_budget", "set_weights", "filter_zones", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_profile"), { profile: "institution" });
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 1500000 });
  assert.deepEqual(argsOf(r.actions, "set_weights"), PROFILE_WEIGHTS.institution);
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { circ: [5, 6], exclude_funded: true });
});

test("p05 goal with no budget asks for the budget and does not plan", () => {
  const r = ask("Voglio aiutare gli anziani soli");
  assert.deepEqual(tools(r.actions), ["set_weights"]);
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["isolation"], "foundation")));
  assert.equal(r.needs_clarification, true);
  assert.match(r.reply, /budget/i);
  assert.equal((r.reply.match(/\?/g) ?? []).length, 1);
});

test("p06 nothing understood asks about the goal", () => {
  const r = ask("Buongiorno, cosa puoi fare?");
  assert.deepEqual(r.actions, []);
  assert.equal(r.needs_clarification, true);
  assert.match(r.reply, /isolamento degli anziani, carenza di servizi o inclusione\?/);
});

test("p07 named area and budget", () => {
  const r = ask("Solo Barriera di Milano, budget 150k");
  assert.deepEqual(tools(r.actions), ["set_budget", "filter_zones", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 150000 });
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { circ: [6] });
});

test("p08 min_over75 phrase is not a goal or a budget", () => {
  const r = ask("Servono almeno 500 over 75 per zona, con 250.000 euro");
  assert.deepEqual(tools(r.actions), ["set_budget", "filter_zones", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 250000 });
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { min_over75: 500 });
});

test("p09 what-if on the budget, after an earlier budget", () => {
  const messages: ChatMessage[] = [
    user("ho 200.000 euro"),
    { role: "assistant", content: "Fatto." },
    user("e se avessimo 300k?"),
  ];
  const r = runRules(messages, state({ budget_eur: 200000, plan: PLAN }));
  assert.deepEqual(tools(r.actions), ["set_budget", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "set_budget"), { budget_eur: 300000 });
  assert.equal(r.needs_clarification, false);
});

test("p10 opens a zone and writes the memo, without replanning", () => {
  const r = ask("Apri la zona 70 e scrivi il memo per il consiglio", state({ plan: PLAN }));
  assert.deepEqual(tools(r.actions), ["select_zone", "write_memo"]);
  assert.deepEqual(argsOf(r.actions, "select_zone"), { zone_id: 70 });
  assert.equal(r.needs_clarification, false);
  assert.match(r.reply, /Pilonetto/);
});

// ---------------------------------------------------------------------------
// Budget parsing
// ---------------------------------------------------------------------------

const BUDGETS: Array<[string, number]> = [
  ["200.000 euro", 200000],
  ["200000 euro", 200000],
  ["€ 200.000", 200000],
  ["€200.000", 200000],
  ["200.000€", 200000],
  ["200k", 200000],
  ["200 k", 200000],
  ["200 mila euro", 200000],
  ["200mila", 200000],
  ["duecentomila euro", 200000],
  ["centomila", 100000],
  ["cento mila euro", 100000],
  ["duecentocinquantamila", 250000],
  ["1,5 milioni", 1500000],
  ["1.5 milioni", 1500000],
  ["un milione", 1000000],
  ["Un milione e mezzo", 1500000],
  ["mezzo milione", 500000],
  ["2 milioni di euro", 2000000],
  ["due milioni", 2000000],
  ["budget di 150000", 150000],
  ["ho 300.000", 300000],
  ["ho 300.000.", 300000],
  ["200 000 euro", 200000],
  ["2030 euro", 2030],
  ["2.030", 2030],
  ["€ 2000", 2000],
  ["mille euro", 1000],
  ["5000", 5000],
  ["over 75 con 200k", 200000],
  ["circoscrizione 3, 200k", 200000],
  ["circoscrizione 3, 200.000 euro", 200000],
  ["circoscrizioni 3 e 5000", 5000],
  ["zona 70, 90.000 euro", 90000],
  ["il 30% di 200.000 euro", 200000],
  ["nel 2030 con 400k", 400000],
  ["almeno 500 over 75 e 250.000 euro", 250000],
  ["300k invece di 200k", 300000],
  ["invece di 200k facciamo 300k", 300000],
  ["passa da 200k a 300k", 300000],
];

for (const [text, expected] of BUDGETS) {
  test(`parseBudget reads "${text}" as ${expected}`, () => {
    assert.equal(parseBudget(text), expected);
  });
}

const NOT_BUDGETS = [
  "",
  "   ",
  "over 75",
  "over 65",
  "over 50",
  "over75",
  "ultra 75",
  "50-64",
  "fascia 50-64 anni",
  "75 anni",
  "circoscrizione 3",
  "circoscrizioni 2, 5 e 6",
  "circ. 3",
  "circ 3",
  "zona 70",
  "almeno 500 over 75",
  "zone con almeno 1.000 over 75",
  "con più di 500 over 75",
  "30%",
  "30 per cento",
  "nel 2030",
  "2025",
  "1900",
  "2100",
  "500",
  "999",
  "1,5",
  "1000 over",
  "2000 anziani",
  "3000 persone",
  "5.000 abitanti",
  "4000 residenti",
  "5 mila anziani",
  "centomila abitanti",
  "mille grazie",
  "cento",
  "dieci zone",
  "Buongiorno, cosa puoi fare?",
];

for (const text of NOT_BUDGETS) {
  test(`parseBudget finds no budget in "${text}"`, () => {
    assert.equal(parseBudget(text), null);
  });
}

test("budgetKnown looks at user messages, a changed budget and an existing plan", () => {
  assert.equal(budgetKnown([], state()), false);
  assert.equal(budgetKnown([user("Voglio aiutare gli anziani")], state()), false);
  assert.equal(budgetKnown([{ role: "assistant", content: "Hai 200k?" }], state()), false);
  assert.equal(budgetKnown([user("ho 200k"), user("anziani")], state()), true);
  assert.equal(budgetKnown([], state({ budget_eur: 200000 })), true);
  assert.equal(budgetKnown([], state({ plan: PLAN })), true);
});

// ---------------------------------------------------------------------------
// Behaviour spec
// ---------------------------------------------------------------------------

test("actions come from the last user message only", () => {
  const r = runRules(
    [user("ho 200k e voglio aiutare gli anziani"), { role: "assistant", content: "Fatto." }, user("Buongiorno")],
    state(),
  );
  assert.deepEqual(r.actions, []);
  assert.equal(r.needs_clarification, true);
});

test("an earlier budget in the chat stops the budget question", () => {
  const r = runRules([user("ho 200k"), { role: "assistant", content: "Fatto." }, user("voglio aiutare gli anziani")], state());
  assert.deepEqual(tools(r.actions), ["set_weights", "run_plan"]);
  assert.equal(r.needs_clarification, false);
});

for (const phrase of ["ricalcola", "calcola il piano", "genera il piano", "rifai il piano", "dove investire", "dove conviene"]) {
  test(`"${phrase}" runs the plan on its own`, () => {
    const r = ask(phrase, state({ budget_eur: 200000 }));
    assert.deepEqual(tools(r.actions), ["run_plan"]);
    assert.equal(r.needs_clarification, false);
  });
}

test("a memo with an empty plan runs the plan first, with a plan it does not", () => {
  assert.deepEqual(tools(ask("scrivi il memo").actions), ["run_plan", "write_memo"]);
  assert.deepEqual(tools(ask("scrivi il memo", state({ plan: PLAN })).actions), ["write_memo"]);
});

for (const phrase of ["nota per il consiglio", "un brief", "documento per il cda", "relazione per il consiglio"]) {
  test(`"${phrase}" asks for the memo`, () => {
    assert.deepEqual(tools(ask(phrase, state({ plan: PLAN })).actions), ["write_memo"]);
  });
}

test("a goal with no budget drops the memo and the plan", () => {
  const r = ask("voglio aiutare gli anziani e scrivi il memo");
  assert.deepEqual(tools(r.actions), ["set_weights"]);
  assert.equal(r.needs_clarification, true);
});

test("a profile with no budget and no goal gets its preset and the budget question", () => {
  const r = ask("Siamo una cooperativa");
  assert.deepEqual(tools(r.actions), ["set_profile", "set_weights"]);
  assert.deepEqual(argsOf(r.actions, "set_weights"), PROFILE_WEIGHTS.third_sector);
  assert.equal(r.needs_clarification, true);
  assert.match(r.reply, /budget/i);
});

test("a filter with no budget asks for the budget, gets no weights and does not plan", () => {
  const r = ask("solo circoscrizione 3");
  assert.deepEqual(tools(r.actions), ["filter_zones"]);
  assert.equal(r.needs_clarification, true);
  assert.match(r.reply, /budget/i);
});

test("a budget or filter with no goal and no profile gets no weights", () => {
  assert.deepEqual(tools(ask("ho 200k").actions), ["set_budget", "run_plan"]);
  assert.deepEqual(tools(ask("solo circoscrizione 3", state({ budget_eur: 200000 })).actions), ["filter_zones", "run_plan"]);
});

test("weights use the profile stated this turn, else the state's profile", () => {
  const stated = ask("Siamo un'associazione, 100k per gli anziani");
  assert.deepEqual(argsOf(stated.actions, "set_weights"), expectedWeights(weightsFor(["isolation"], "third_sector")));
  const inherited = ask("100k per gli anziani", state({ profile: "institution" }));
  assert.deepEqual(argsOf(inherited.actions, "set_weights"), expectedWeights(weightsFor(["isolation"], "institution")));
});

test("several goals are combined", () => {
  const r = ask("200k per gli anziani e l'inclusione");
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["isolation", "inclusion"], "foundation")));
});

const EXCLUDE_TRUE = [
  "evita PNRR",
  "evita le zone già coperte dal PNRR",
  "zone già finanziate",
  "evita sovrapposizioni",
  "zone non già coperte",
];
for (const phrase of EXCLUDE_TRUE) {
  test(`"${phrase}" sets exclude_funded true`, () => {
    assert.deepEqual(argsOf(ask(`${phrase}, 200k`).actions, "filter_zones"), { exclude_funded: true });
  });
}

for (const phrase of ["includi anche le zone già finanziate", "non evitare le zone già coperte", "non evitare il PNRR"]) {
  test(`"${phrase}" sets exclude_funded false`, () => {
    assert.deepEqual(argsOf(ask(`${phrase}, 200k`).actions, "filter_zones"), { exclude_funded: false });
  });
}

test("a bare mention of the PNRR is not a filter", () => {
  assert.equal(argsOf(ask("cosa c'è nel PNRR? ho 200k").actions, "filter_zones"), undefined);
});

// ---------------------------------------------------------------------------
// Goals and negation
// ---------------------------------------------------------------------------

const GOAL_CASES: Array<[string, "isolation" | "service_gap" | "future_pressure" | "inclusion"]> = [
  ["over 75", "isolation"],
  ["ultra 75", "isolation"],
  ["anziani soli", "isolation"],
  ["persone sole", "isolation"],
  ["solitudine", "isolation"],
  ["isolamento", "isolation"],
  ["isolati", "isolation"],
  ["vivono soli", "isolation"],
  ["grandi anziani", "isolation"],
  ["carenza servizi", "service_gap"],
  ["carenza di servizi", "service_gap"],
  ["mancano i servizi", "service_gap"],
  ["servizi scarsi", "service_gap"],
  ["lontani dai servizi", "service_gap"],
  ["pochi servizi", "service_gap"],
  ["farmacie", "service_gap"],
  ["presidi sanitari", "service_gap"],
  ["accesso alla salute", "service_gap"],
  ["accesso sanitario", "service_gap"],
  ["pressione futura", "future_pressure"],
  ["invecchiamento", "future_pressure"],
  ["2030", "future_pressure"],
  ["prossimi anni", "future_pressure"],
  ["previsione", "future_pressure"],
  ["futuro", "future_pressure"],
  ["inclusione", "inclusion"],
  ["inserimento lavorativo", "inclusion"],
  ["lavoro", "inclusion"],
  ["lavorativa", "inclusion"],
  ["occupazione", "inclusion"],
  ["over 50", "inclusion"],
  ["nuovi residenti", "inclusion"],
  ["stranieri", "inclusion"],
  ["migranti", "inclusion"],
  ["barriere linguistiche", "inclusion"],
  ["lingua", "inclusion"],
];

for (const [phrase, goal] of GOAL_CASES) {
  test(`"${phrase}" is the goal ${goal}`, () => {
    const r = ask(`ho 200.000 euro: ${phrase}`);
    assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor([goal], "foundation")));
  });
}

for (const phrase of ["non gli anziani", "senza anziani", "non per il lavoro", "non le farmacie", "non mi interessano gli anziani"]) {
  test(`"${phrase}" skips the goal`, () => {
    const r = ask(`ho 200k: ${phrase}`);
    assert.deepEqual(tools(r.actions), ["set_budget", "run_plan"]);
  });
}

test("a negated goal leaves the other goal", () => {
  const r = ask("200k, non gli over 50 ma gli anziani");
  assert.deepEqual(argsOf(r.actions, "set_weights"), expectedWeights(weightsFor(["isolation"], "foundation")));
});

test("a negation further than three words back, or in another clause, does not count", () => {
  const far = ask("non abbiamo ancora deciso molto ma 200k per gli anziani");
  assert.ok(tools(far.actions).includes("set_weights"));
  const clause = ask("non so, 200k, anziani");
  assert.ok(tools(clause.actions).includes("set_weights"));
});

test('"non solo" does not negate', () => {
  assert.ok(tools(ask("200k, non solo gli anziani").actions).includes("set_weights"));
});

test("a negated goal alone understands nothing", () => {
  const r = ask("non gli anziani");
  assert.deepEqual(r.actions, []);
  assert.equal(r.needs_clarification, true);
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const PROFILES_CASES: Array<[string, "foundation" | "third_sector" | "institution"]> = [
  ["fondazione", "foundation"],
  ["fondazione bancaria", "foundation"],
  ["terzo settore", "third_sector"],
  ["associazione", "third_sector"],
  ["cooperativa", "third_sector"],
  ["ETS", "third_sector"],
  ["onlus", "third_sector"],
  ["Comune", "institution"],
  ["assessorato", "institution"],
  ["ente pubblico", "institution"],
  ["istituzione", "institution"],
  ["Regione", "institution"],
];

for (const [phrase, profile] of PROFILES_CASES) {
  test(`"${phrase}" is the profile ${profile}`, () => {
    assert.deepEqual(argsOf(ask(`${phrase}, 200k`).actions, "set_profile"), { profile });
  });
}

test("a circoscrizione as speaker is not a profile", () => {
  const r = ask("Siamo la circoscrizione 3, abbiamo 200k");
  assert.deepEqual(tools(r.actions), ["set_budget", "filter_zones", "run_plan"]);
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { circ: [3] });
});

test('"bene comune" and "in comune" are not the municipality', () => {
  assert.equal(argsOf(ask("200k per il bene comune").actions, "set_profile"), undefined);
  assert.equal(argsOf(ask("200k da mettere in comune").actions, "set_profile"), undefined);
});

test("a funder named after someone else's money is not the speaker", () => {
  assert.equal(argsOf(ask("200k, evita le zone già finanziate dalla fondazione").actions, "set_profile"), undefined);
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const MIN_CASES: Array<[string, number]> = [
  ["almeno 500 over 75", 500],
  ["minimo 500 over 75", 500],
  ["con più di 500 over 75", 500],
  ["zone con almeno 1.000 over 75", 1000],
];

for (const [phrase, value] of MIN_CASES) {
  test(`"${phrase}" sets min_over75 ${value} and no goal`, () => {
    const r = ask(`${phrase}, con 250.000 euro`);
    assert.deepEqual(tools(r.actions), ["set_budget", "filter_zones", "run_plan"]);
    assert.deepEqual(argsOf(r.actions, "filter_zones"), { min_over75: value });
  });
}

const CIRC_CASES: Array<[string, number[]]> = [
  ["circoscrizione 3", [3]],
  ["circoscrizioni 3 e 7", [3, 7]],
  ["circoscrizioni 2, 5 e 6", [2, 5, 6]],
  ["circ. 5", [5]],
  ["circ 5", [5]],
];

for (const [phrase, circ] of CIRC_CASES) {
  test(`"${phrase}" filters circ ${circ.join(",")}`, () => {
    assert.deepEqual(argsOf(ask(`${phrase}, 200k`).actions, "filter_zones"), { circ });
  });
}

const AREAS: Array<[number, string[]]> = [
  [1, ["in centro", "zona centro", "crocetta"]],
  [2, ["santa rita", "mirafiori"]],
  [3, ["san paolo", "cenisia", "pozzo strada", "cit turin", "borgata lesna"]],
  [4, ["san donato", "campidoglio", "parella"]],
  [5, ["borgo vittoria", "madonna di campagna", "lucento", "vallette"]],
  [6, ["barriera di milano", "regio parco", "barca", "bertolla", "falchera", "rebaudengo", "villaretto"]],
  [7, ["aurora", "vanchiglia", "vanchiglietta", "madonna del pilone", "sassi"]],
  [8, ["san salvario", "cavoretto", "borgo po", "nizza millefonti", "lingotto", "filadelfia"]],
];

for (const [circ, names] of AREAS) {
  for (const name of names) {
    test(`"${name}" is circoscrizione ${circ}`, () => {
      assert.deepEqual(argsOf(ask(`200k, ${name}`).actions, "filter_zones"), { circ: [circ] });
    });
  }
}

test('"centro" as a common word is not the district', () => {
  assert.equal(argsOf(ask("200k per un centro anziani").actions, "filter_zones"), undefined);
  assert.equal(argsOf(ask("200k, mettiamo al centro gli anziani").actions, "filter_zones"), undefined);
});

test("Compagnia di San Paolo is a funder, not the neighbourhood", () => {
  assert.equal(argsOf(ask("Fondazione Compagnia di San Paolo, 200k").actions, "filter_zones"), undefined);
});

for (const phrase of ["togli i filtri", "rimuovi i filtri", "reset filtri", "tutta la città", "tutte le circoscrizioni"]) {
  test(`"${phrase}" resets the filters`, () => {
    const r = ask(phrase, state({ budget_eur: 200000 }));
    assert.deepEqual(tools(r.actions), ["filter_zones", "run_plan"]);
    assert.deepEqual(argsOf(r.actions, "filter_zones"), { circ: [], exclude_funded: false, min_over75: 0 });
  });
}

test("an out-of-range circoscrizione is ignored and the reply says so", () => {
  const r = ask("circoscrizione 12, 200k");
  assert.deepEqual(tools(r.actions), ["set_budget", "run_plan"]);
  assert.match(r.reply, /circoscrizione 12 non esiste/i);
});

test("out-of-range values are dropped, valid ones stay", () => {
  const r = ask("circoscrizioni 3, 9 e 0, con 200k");
  assert.deepEqual(argsOf(r.actions, "filter_zones"), { circ: [3] });
  assert.match(r.reply, /9/);
  assert.match(r.reply, /ignorate/);
});

test("an out-of-range circoscrizione alone asks about the goal and still says so", () => {
  const r = ask("circoscrizione 12");
  assert.deepEqual(r.actions, []);
  assert.equal(r.needs_clarification, true);
  assert.match(r.reply, /circoscrizione 12 non esiste/i);
  assert.match(r.reply, /inclusione\?/);
});

// ---------------------------------------------------------------------------
// select_zone
// ---------------------------------------------------------------------------

for (const phrase of ["zona 70", "apri la zona 70", "mostrami la zona 70"]) {
  test(`"${phrase}" selects zone 70`, () => {
    assert.deepEqual(ask(phrase, state({ plan: PLAN })).actions, [{ tool: "select_zone", args: { zone_id: 70 } }]);
  });
}

for (const phrase of ["apri Pilonetto", "mostra Pilonetto", "seleziona Pilonetto", "vai a Pilonetto", "dettagli su Pilonetto"]) {
  test(`"${phrase}" selects a zone from the plan by name`, () => {
    assert.deepEqual(ask(phrase, state({ plan: PLAN })).actions, [{ tool: "select_zone", args: { zone_id: 70 } }]);
  });
}

test("a plan zone named like an area opens the zone instead of filtering", () => {
  assert.deepEqual(ask("apri Barriera di Milano", state({ plan: PLAN })).actions, [
    { tool: "select_zone", args: { zone_id: 12 } },
  ]);
});

test("a zone name without a verb does not select", () => {
  const r = ask("Pilonetto", state({ plan: PLAN }));
  assert.deepEqual(r.actions, []);
});

test("a zone not in the plan still selects when given by number", () => {
  const r = ask("apri la zona 44", state({ plan: PLAN }));
  assert.deepEqual(r.actions, [{ tool: "select_zone", args: { zone_id: 44 } }]);
  assert.match(r.reply, /zona 44/);
});

// ---------------------------------------------------------------------------
// Replies, validity and robustness, over everything a demo might type
// ---------------------------------------------------------------------------

const CORPUS: Array<[string, AppState]> = [
  ["ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR", state()],
  ["Siamo una fondazione bancaria con 500k: dove investiamo per ridurre la carenza di servizi?", state()],
  ["Terzo settore, abbiamo 80 mila euro per l'inclusione lavorativa degli over 50", state()],
  ["Come assessorato abbiamo 1,5 milioni, concentrati sulle circoscrizioni 5 e 6 ed evita sovrapposizioni con il PNRR", state()],
  ["Voglio aiutare gli anziani soli", state()],
  ["Buongiorno, cosa puoi fare?", state()],
  ["Solo Barriera di Milano, budget 150k", state()],
  ["Servono almeno 500 over 75 per zona, con 250.000 euro", state()],
  ["e se avessimo 300k?", state({ budget_eur: 200000, plan: PLAN })],
  ["Apri la zona 70 e scrivi il memo per il consiglio", state({ plan: PLAN })],
  ["duecentomila euro per stranieri e barriere linguistiche", state()],
  ["mezzo milione per i nuovi residenti, solo Aurora", state({ profile: "institution" })],
  ["un milione e mezzo, in centro, zone con almeno 1.000 over 75", state()],
  ["ricalcola", state({ budget_eur: 200000 })],
  ["togli i filtri", state({ budget_eur: 200000 })],
  ["includi anche le zone già finanziate, 90000 euro", state()],
  ["circoscrizioni 2, 5, 6 e 12, con 700k", state()],
  ["circoscrizione 12", state()],
  ["scrivi il memo", state()],
  ["apri Pilonetto", state({ plan: PLAN })],
  ["Siamo una cooperativa", state()],
  ["solo San Salvario", state()],
  ["100 milioni per gli anziani", state()],
  ["ho 500 euro", state()],
  ["almeno 200.000 over 75, con 200k", state()],
  ["voglio l'indice SROI per gli anziani con 200k", state()],
  ["Dove conviene investire per il 2030?", state({ budget_eur: 300000 })],
  ["Siamo una fondazione, 200k, circoscrizione 3, evita il PNRR e scrivi il memo", state()],
];

for (const [text, appState] of CORPUS) {
  test(`reply and actions hold the rules: ${text}`, () => {
    const r = ask(text, appState);
    assert.equal(r.mode, "rules");

    // Every action already is what the validator would return.
    for (const action of r.actions) assert.deepEqual(validateAction(action), action);

    const order = ["set_profile", "set_budget", "set_weights", "filter_zones", "run_plan", "select_zone", "write_memo"];
    const positions = r.actions.map((action) => order.indexOf(action.tool));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "canonical order");

    assert.ok(r.reply.trim().length > 0);
    assert.doesNotMatch(r.reply, /sroi/i);
    assert.doesNotMatch(r.reply, /rischio/i);
    // parseBudget supplies what the user wrote in words ("un milione e mezzo"), before any clamping.
    const written = { text, budget: parseBudget(text), zones: appState.plan.map((item) => item.zone_name) };
    assert.deepEqual(findUnsupportedNumbers(r.reply, written), []);
    // "over 75" is a label extractNumbers ignores, so check it directly: only echoed, never invented.
    if (/over 75/.test(r.reply)) assert.match(text.toLowerCase(), /(?:over|ultra)[\s-]?75/);

    const sentences = r.reply.split(/(?<=[.?!])\s+/).filter((part) => part.trim() !== "");
    assert.ok(sentences.length <= 2, `at most two sentences, got: ${r.reply}`);
  });
}

test("the reply frames the result for each funder", () => {
  for (const profile of ["foundation", "third_sector", "institution"] as const) {
    const r = ask("200k per gli anziani", state({ profile }));
    assert.ok(r.reply.includes(PROFILE_FOCUS[profile]), r.reply);
  }
});

test("a named area is echoed by name, with no number the user did not write", () => {
  const r = ask("Solo Barriera di Milano, budget 150k");
  assert.match(r.reply, /Barriera di Milano/);
  assert.match(r.reply, /150\.000 €/);
  assert.doesNotMatch(r.reply, /\b6\b/);
});

test("budgets outside the limits are clamped, and the reply invents no figure", () => {
  const high = ask("100 milioni per gli anziani");
  assert.deepEqual(argsOf(high.actions, "set_budget"), { budget_eur: 50_000_000 });
  assert.doesNotMatch(high.reply, /50\.000\.000/);
  const low = ask("ho 500 euro");
  assert.deepEqual(argsOf(low.actions, "set_budget"), { budget_eur: 1000 });
  assert.doesNotMatch(low.reply, /1\.000/);
});

test("foreign residents read as an access and language need", () => {
  const r = ask("duecentomila euro per gli stranieri");
  assert.match(r.reply, /barriere di accesso e di lingua/);
});

test("empty input returns the goal question", () => {
  for (const messages of [[], [user("")], [user("   ")], [{ role: "assistant", content: "Ciao" } as ChatMessage]]) {
    const r = runRules(messages, state());
    assert.deepEqual(r.actions, []);
    assert.equal(r.needs_clarification, true);
    assert.match(r.reply, /inclusione\?/);
  }
});

test("an empty last message does not replay the turn before it", () => {
  const r = runRules([user("ho 200k"), { role: "assistant", content: "Fatto." }, user("")], state());
  assert.deepEqual(r.actions, []);
});

test("malformed input never throws", () => {
  const bad: unknown[] = [null, undefined, 42, "x", {}, [], [null], [{}], [{ role: "user" }], [{ role: "user", content: 7 }]];
  for (const messages of bad) {
    for (const appState of [null, undefined, {}, { plan: "x" }, { plan: [null, { zone_id: "a" }] }, state()]) {
      const r = runRules(messages as ChatMessage[], appState as AppState);
      assert.equal(r.mode, "rules");
      assert.ok(Array.isArray(r.actions));
      assert.equal(typeof r.reply, "string");
      assert.equal(typeof budgetKnown(messages as ChatMessage[], appState as AppState), "boolean");
    }
    assert.equal(parseBudget(messages as string), null);
  }
});

test("a plan with malformed items does not break a real request", () => {
  const plan = [null, { zone_id: "a" }, { zone_id: 5 }, ...PLAN] as unknown as PlanItem[];
  const r = ask("apri Pilonetto", state({ plan }));
  assert.deepEqual(r.actions, [{ tool: "select_zone", args: { zone_id: 70 } }]);
});

test("runRules is deterministic and leaves its input alone", () => {
  const appState = state({ plan: PLAN });
  const before = structuredClone(appState);
  const messages = [user("200k, solo Aurora")];
  assert.deepEqual(runRules(messages, appState), runRules(messages, appState));
  assert.deepEqual(appState, before);
  assert.deepEqual(DEFAULT_STATE.filters, { circ: [], exclude_funded: false, min_over75: 0 });
});
