import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_STATE } from "../src/contract.js";
import type { MemoRequest, PlanItem, Profile, Source, ZoneProperties } from "../src/contract.js";
import { setClientForTests } from "../src/llm.js";
import { buildFacts, checkMemo, MEMO_HEADINGS, MOCK_LINE, templateMemo, writeMemo } from "../src/memo.js";
import { findUnsupportedNumbers } from "../src/numbers.js";

afterEach(() => setClientForTests(undefined));

function planItem(zoneId: number, name: string, overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    zone_id: zoneId,
    zone_name: name,
    circ: 6,
    intervention_id: "presidio",
    intervention_label: "Presidio di prossimità",
    budget_eur: 50000,
    people_reached: 1200,
    cost_per_person_eur: 41.67,
    return_index: 0.0423,
    scores: { isolation: 0.82, service_gap: 0.71, future_pressure: 0.65, inclusion: 0.42, funded_share: 0.12 },
    confidence: "official",
    ...overrides,
  };
}

function zone(id: number, name: string, overrides: Partial<ZoneProperties> = {}): ZoneProperties {
  return {
    id,
    name,
    circ: 6,
    pop_2025: 23450,
    over65_est: 5400,
    over75_est: 2300,
    adults_50_64_est: 4100,
    over75_2030: 2510,
    alone_rate_circ: 0.32,
    foreign_share: 0.28,
    isolation: 0.82,
    service_gap: 0.71,
    future_pressure: 0.65,
    inclusion: 0.42,
    funded_eur: 120000,
    funded_projects: 3,
    funded_share: 0.42,
    nearest: { health_m: 900, care_m: 450, pharmacy_m: 210 },
    services_800m: 2,
    stability_top10: 0.9,
    confidence: "official",
    small_zone: false,
    ...overrides,
  };
}

const SOURCES: Source[] = [
  { key: "anagrafe", label: "Anagrafe del Comune di Torino", url: "http://aperto.comune.torino.it/dataset/popolazione", year: 2025, level: "zona statistica" },
  { key: "istat", label: "Censimento ISTAT", url: "https://www.istat.it/censimenti/popolazione", year: 2021, level: "Circoscrizione" },
  { key: "fondi", label: "Open data dei bandi di fondazione", url: "https://dati.example.org/bandi/welfare-torino", year: 2024, level: "zona statistica" },
  { key: "servizi", label: "Mappa dei servizi sociosanitari", url: "https://dati.example.org/servizi", year: 2024, level: "punto" },
  { key: "farmacie", label: "Farmacie della Regione Piemonte", url: "https://dati.example.org/farmacie", year: 2023, level: "punto" },
];

const OTHER_ZONE = zone(77, "Zona fuori dal piano", { funded_eur: 987654, over75_est: 31337 });

function request(overrides: Partial<MemoRequest> = {}): MemoRequest {
  const plan = overrides.plan ?? [
    planItem(1, "Barriera di Milano"),
    planItem(2, "Falchera", { budget_eur: 30000, people_reached: 800, cost_per_person_eur: 37.5, return_index: 0.031, confidence: "estimated", circ: 5 }),
    planItem(3, "Vallette", { budget_eur: 15000, people_reached: 400, cost_per_person_eur: 37.5, return_index: 0.029, confidence: "low", circ: 5 }),
  ];
  return {
    state: { ...DEFAULT_STATE, plan },
    plan,
    zones: [zone(1, "Barriera di Milano"), zone(2, "Falchera", { funded_eur: 0, funded_projects: 0, funded_share: 0, circ: 5 }), zone(3, "Vallette", { funded_projects: 1, funded_eur: 1000, funded_share: 0.125, circ: 5, small_zone: true }), OTHER_ZONE],
    sources: SOURCES,
    ...overrides,
  };
}

function nullsRequest(): MemoRequest {
  const broken = {
    ...planItem(1, "Barriera di Milano"),
    people_reached: null,
    cost_per_person_eur: undefined,
    return_index: Number.NaN,
    scores: undefined,
    confidence: null,
    circ: null,
  } as unknown as PlanItem;
  const absent = planItem(50, "Zona assente dai dati", { budget_eur: Number.NaN });
  return request({
    plan: [broken, absent],
    zones: [
      zone(1, "Barriera di Milano", {
        over75_2030: null,
        stability_top10: null,
        nearest: { health_m: 900, care_m: 450, pharmacy_m: null },
        funded_eur: null as unknown as number,
        funded_projects: undefined as unknown as number,
        funded_share: Number.NaN,
      }),
    ],
    sources: [
      { key: "senza_url", label: "Fonte senza link", url: "", year: 2020, level: "" },
      { key: "senza_anno" } as unknown as Source,
      null as unknown as Source,
    ],
  });
}

/** The link complaints checkMemo gives for this text, whatever else it finds. */
function unknownLinksOf(markdown: string, sources: Source[]): string[] {
  const facts = buildFacts(request({ sources }));
  return checkMemo(markdown, facts).filter((failure) => failure.startsWith("link "));
}

const CASES: Array<[string, () => MemoRequest]> = [
  ["normal plan", () => request()],
  ["plan with nulls", nullsRequest],
  ["empty plan", () => request({ plan: [] })],
  ["empty plan, no sources, no zones", () => request({ plan: [], zones: [], sources: [] })],
  ["10 rows and 15 sources", fullSizeRequest],
  [
    "long plan with no budget left",
    () => request({ plan: Array.from({ length: 13 }, (_, i) => planItem(i + 1, `Zona ${String.fromCharCode(65 + i)}`, { budget_eur: 10000 })) }),
  ],
];

function headingsOf(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? "");
}

/** What counts toward one page: everything except link targets, which the reader does not see. */
function visibleLength(markdown: string): number {
  return markdown.replace(/\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "]").length;
}

const ONE_PAGE = 3000;
const ONE_PAGE_FULL_TABLE = 3700;

/** Real-size request: 10 plan rows in 10 zones and 15 sources, as in Machine C's meta.json. */
function fullSizeRequest(): MemoRequest {
  const names = [
    "Barriera di Milano", "Falchera", "Vallette", "Mirafiori Nord", "Aurora", "San Salvario",
    "Borgo Vittoria", "Madonna di Campagna", "Lucento", "Parella",
  ];
  const interventions = [
    "Sicurezza digitale e anti-truffa", "Presidio di prossimità per anziani", "Trasporto sociale a chiamata",
    "Sportello linguistico e di accesso", "Assistenza domiciliare leggera",
  ];
  const plan = names.map((name, i) =>
    planItem(i + 1, name, {
      circ: (i % 8) + 1,
      intervention_label: interventions[i % interventions.length] ?? "",
      budget_eur: 10000,
      people_reached: 210 + i * 37,
      cost_per_person_eur: Math.round((10000 / (210 + i * 37)) * 100) / 100,
      return_index: 0.0118 + i / 1000,
      scores: { isolation: 62 - i, service_gap: 48 + i, future_pressure: 55, inclusion: 21, funded_share: 0.1 },
      confidence: i % 3 === 0 ? "official" : i % 3 === 1 ? "estimated" : "low",
    }),
  );
  const levels = ["zona statistica", "Circoscrizione", "punto", "città"];
  const labels = [
    "Anagrafe del Comune di Torino", "Censimento ISTAT della popolazione", "Bandi delle fondazioni torinesi",
    "Mappa dei servizi sociosanitari", "Farmacie della Regione Piemonte", "Presidi sanitari della ASL Città di Torino",
    "Progetti finanziati dal Comune", "Osservatorio sulla popolazione anziana", "Proiezioni demografiche regionali",
    "Stranieri residenti per Circoscrizione", "Famiglie unipersonali per Circoscrizione", "Centri di incontro per anziani",
    "Trasporto pubblico locale GTT", "Rete delle case del quartiere", "Registro degli enti del terzo settore",
  ];
  return {
    state: { ...DEFAULT_STATE, plan },
    plan,
    zones: names.map((name, i) => zone(i + 1, name, { circ: (i % 8) + 1, funded_eur: 25000 * (i + 1), funded_projects: i + 1, funded_share: (i + 1) / 20 })),
    sources: labels.map((sourceLabel, i) => ({
      key: `fonte_${i}`,
      label: sourceLabel,
      url: `https://dati.example.org/torino/dataset-${i}/risorsa/ultima-versione`,
      year: 2019 + (i % 7),
      level: levels[i % levels.length] ?? "",
    })),
  };
}

for (const [name, make] of CASES) {
  test(`template passes the number check against its own facts: ${name}`, () => {
    const req = make();
    assert.deepEqual(findUnsupportedNumbers(templateMemo(req), buildFacts(req)), []);
  });

  test(`template passes every check it demands of the LLM: ${name}`, () => {
    const req = make();
    assert.deepEqual(checkMemo(templateMemo(req), buildFacts(req)), []);
  });

  test(`template has the six headings in order: ${name}`, () => {
    assert.deepEqual(headingsOf(templateMemo(make())), [...MEMO_HEADINGS]);
  });

  test(`template never prints SROI, null, undefined or NaN: ${name}`, () => {
    const markdown = templateMemo(make());
    assert.doesNotMatch(markdown, /sroi/i);
    assert.doesNotMatch(markdown, /\b(?:null|undefined|nan)\b/i);
    assert.doesNotMatch(markdown, /\[object/);
  });

  test(`template frames foreign residents as access, never risk: ${name}`, () => {
    assert.doesNotMatch(templateMemo(make()), /rischi/i);
  });
}

test("template meets the format rules for a normal plan", (t) => {
  const markdown = templateMemo(request());
  t.diagnostic(`piano normale: ${visibleLength(markdown)} caratteri visibili`);
  assert.ok(visibleLength(markdown) <= ONE_PAGE, `${visibleLength(markdown)} caratteri`);
  assert.match(markdown, /^## Sintesi\n\nRaccomandiamo di destinare il prossimo investimento a Barriera di Milano, Falchera e Vallette/);
  assert.match(markdown, /indice di ritorno atteso è una stima comparativa/i);
  assert.match(markdown, /\| Costo per persona \(ipotesi\) \|/);
  assert.match(markdown, /persona \(ipotesi del team, modificabili\)/);
  assert.match(markdown, /## Limiti dei dati[\s\S]*non quelli cittadini[\s\S]*## Fonti/);
  assert.match(markdown, /## Limiti dei dati[\s\S]*ipotesi del team, modificabili[\s\S]*## Fonti/);
  assert.match(markdown, /valore di Circoscrizione, non di zona/);
  assert.match(markdown, /persone sole 32% \(Circoscrizione\)/);
  assert.match(markdown, /Livelli dei dati: zona statistica, Circoscrizione, punto/);
  assert.match(markdown, /\*\*Circoscrizione:\*\* \[Censimento ISTAT\]\(https:\/\/www\.istat\.it\/censimenti\/popolazione\) \(2021\)\./);
  assert.match(markdown, /\| Barriera di Milano \| 6 \| Presidio di prossimità \| 50\.000 € \| 1200 \| 41,67 € \| 0,042 \| ufficiale \|/);
  assert.match(markdown, /\| Falchera .* \| stimata \|/);
  assert.match(markdown, /\| Vallette .* \| bassa \|/);
  assert.match(markdown, /- Barriera di Milano: 120\.000 €, 3 progetti, quota 42%\./);
  assert.match(markdown, /- Falchera: 0 €, 0 progetti, quota 0%\./);
  assert.match(markdown, /- Vallette: 1000 €, 1 progetto, quota 12,5%\./);
  assert.match(markdown, /residenti stranieri 28%/);
  assert.match(markdown, /bisogno di accesso e di lingua/);
  assert.match(markdown, /over 75: 2300 \(stima\)/);
  assert.match(markdown, /Restano da allocare 5000 €/);
  assert.match(markdown, /Già finanziati in queste zone: 121\.000 €/);
  assert.equal([...markdown.matchAll(/121\.000 €/g)].length, 1, "il totale dei fondi compare una volta sola");
});

test("template stays near one page with a full table", () => {
  const req = CASES.find(([name]) => name.startsWith("long plan"))?.[1]();
  assert.ok(req);
  const markdown = templateMemo(req);
  assert.ok(visibleLength(markdown) <= ONE_PAGE_FULL_TABLE, `${visibleLength(markdown)} caratteri`);
});

test("template stays within the ceiling with 10 rows and 15 sources", (t) => {
  const req = fullSizeRequest();
  const markdown = templateMemo(req);
  t.diagnostic(`10 righe, 15 fonti: ${visibleLength(markdown)} caratteri visibili`);
  assert.ok(visibleLength(markdown) <= ONE_PAGE_FULL_TABLE, `${visibleLength(markdown)} caratteri`);
  assert.deepEqual(checkMemo(markdown, buildFacts(req)), []);
  assert.equal([...markdown.matchAll(/^\| (?!Zona |---)/gm)].length, 10);
});

test("Fonti keeps every source and year as a link, with no visible URL", () => {
  const req = fullSizeRequest();
  const markdown = templateMemo(req);
  const fonti = markdown.slice(markdown.indexOf("## Fonti"));
  assert.equal(req.sources.length, 15);
  for (const source of req.sources) {
    assert.ok(fonti.includes(`[${source.label}](${source.url}) (${source.year})`), source.label);
  }
  assert.doesNotMatch(fonti.replace(/\]\([^)]*\)/g, "]"), /https?:/);
  for (const level of ["Zona statistica", "Circoscrizione", "Punto", "Città"]) assert.ok(fonti.includes(`**${level}:**`), level);
});

test("Fonti stays correct without a link, year or level", () => {
  const markdown = templateMemo(
    request({
      sources: [
        { key: "a", label: "Solo testo", url: "", year: 2020, level: "" },
        { key: "b", label: "Con [parentesi] quadre", url: "https://esempio.org/a_(b)", year: 2021, level: "zona" },
        { key: "c", label: "Senza schema", url: "www.esempio.org/c", year: 2022, level: "zona" },
      ],
    }),
  );
  assert.match(markdown, /- Solo testo \(2020\)\./);
  assert.match(markdown, /\[Con parentesi quadre\]\(https:\/\/esempio\.org\/a_\(b\)\) \(2021\); Senza schema, www\.esempio\.org\/c \(2022\)\./);
  assert.deepEqual(unknownLinksOf(markdown, [
    { key: "b", label: "", url: "https://esempio.org/a_(b)", year: 2021, level: "zona" },
    { key: "c", label: "", url: "www.esempio.org/c", year: 2022, level: "zona" },
  ]), []);
});

test("template adapts to the funder profile", () => {
  const expected: Record<Profile, RegExp> = {
    foundation: /Per una fondazione contano impatto e difendibilità[\s\S]*Per il consiglio:/,
    third_sector: /Per un ente del terzo settore contano evidenze da usare in un bando[\s\S]*Per il bando:/,
    institution: /Per un'istituzione pubblica contano copertura del territorio[\s\S]*sovrapposizione/,
  };
  for (const [profile, pattern] of Object.entries(expected)) {
    const req = request();
    req.state = { ...req.state, profile: profile as Profile };
    assert.match(templateMemo(req), pattern);
  }
});

test("template says when no plan has been calculated", () => {
  const markdown = templateMemo(request({ plan: [] }));
  assert.match(markdown, /nessun piano è stato calcolato/i);
  assert.match(markdown, /Nessun piano è stato ancora calcolato/);
  assert.match(markdown, /100\.000 €/);
});

test("template shows at most 10 rows, and the remainder is a supported figure", () => {
  const req = CASES.find(([name]) => name.startsWith("long plan"))?.[1]();
  assert.ok(req);
  const markdown = templateMemo(req);
  assert.equal([...markdown.matchAll(/^\| Zona [A-Z] \|/gm)].length, 10);
  assert.match(markdown, /e altri 3 interventi/);
  assert.deepEqual(findUnsupportedNumbers(markdown, buildFacts(req)), []);
  const eleven = request({ plan: Array.from({ length: 11 }, (_, i) => planItem(i + 1, `Zona ${String.fromCharCode(65 + i)}`, { budget_eur: 1000 })) });
  assert.match(templateMemo(eleven), /e 1 altro intervento/);
});

test("template flags a plan above the budget", () => {
  const req = request();
  req.state = { ...req.state, budget_eur: 50000 };
  const markdown = templateMemo(req);
  assert.match(markdown, /supera il budget di 45\.000 €/);
  assert.deepEqual(findUnsupportedNumbers(markdown, buildFacts(req)), []);
});

test("template never throws, even on garbage", () => {
  const garbage: unknown[] = [
    undefined,
    null,
    {},
    { plan: "x", zones: 3, sources: {} },
    { plan: [null, 1, "x", {}], zones: [null, {}], sources: [1, {}], state: null },
    { plan: [{ zone_id: 1, nearest: 1, scores: 3 }], zones: [{ id: 1, nearest: "x" }], state: { profile: "constructor", budget_eur: "x" } },
    { get plan() { throw new Error("boom"); } },
  ];
  for (const input of garbage) {
    const markdown = templateMemo(input as MemoRequest);
    assert.deepEqual(headingsOf(markdown), [...MEMO_HEADINGS]);
    assert.doesNotMatch(markdown, /\b(?:null|undefined|NaN)\b/);
  }
});

test("mock line is present only when mock is true", () => {
  assert.ok(templateMemo(request({ mock: true })).startsWith(`${MOCK_LINE}\n\n## Sintesi`));
  assert.ok(!templateMemo(request({ mock: false })).includes("DATI DI PROVA"));
  assert.ok(!templateMemo(request()).includes("DATI DI PROVA"));
  assert.equal(MOCK_LINE, "> **DATI DI PROVA**: questo memo usa dati fittizi e non va usato per decisioni reali.");
});

test("facts hold only plan zones, all sources and the server-computed figures", () => {
  const facts = buildFacts(request());
  assert.deepEqual(facts.zones.map((z) => z.id), [1, 2, 3]);
  assert.equal(facts.sources.length, SOURCES.length);
  assert.equal(facts.budget_eur, 100000);
  assert.deepEqual(
    {
      allocated: facts.computed_by_server.total_allocated_eur,
      people: facts.computed_by_server.total_people_reached_stima,
      cost: facts.computed_by_server.overall_cost_per_person_eur,
      interventions: facts.computed_by_server.interventions_count,
      zones: facts.computed_by_server.distinct_zones_count,
      left: facts.computed_by_server.budget_not_allocated_eur,
      funded: facts.computed_by_server.funded_eur_plan_zones,
    },
    { allocated: 95000, people: 2400, cost: 39.58, interventions: 3, zones: 3, left: 5000, funded: 121000 },
  );
  assert.equal(facts.display.total_allocated, "95.000 €");
  assert.equal(facts.display.plan[0]?.return_index, "0,042");
  assert.equal(facts.display.zones[0]?.funded_share, "42%");
  assert.equal(facts.display.zones[0]?.alone_rate_circoscrizione, "32%");
  assert.deepEqual(findUnsupportedNumbers("987.654 € e 31337", facts), ["987.654", "31337"]);
});

// ---------------------------------------------------------------------------
// LLM path, through a fake client. The real API has not been called from these tests.
// ---------------------------------------------------------------------------

interface Captured {
  body?: Record<string, unknown>;
  options?: { timeout?: number; maxRetries?: number; signal?: AbortSignal };
}

function fakeClient(create: (body: unknown, options: unknown) => unknown): Anthropic {
  return { beta: { messages: { create } } } as unknown as Anthropic;
}

function answer(text: string, stopReason = "end_turn", blocks?: unknown[]) {
  return { stop_reason: stopReason, content: blocks ?? [{ type: "text", text }] };
}

function useText(text: string, stopReason = "end_turn"): Captured {
  const captured: Captured = {};
  setClientForTests(
    fakeClient(async (body, options) => {
      captured.body = body as Record<string, unknown>;
      captured.options = options as Captured["options"];
      return answer(text, stopReason);
    }),
  );
  return captured;
}

const GOOD_TEXT = `## Sintesi

Raccomandiamo di partire da Barriera di Milano, dove il bisogno è più alto e i fondi già attivi sono noti. Il piano assegna 95.000 € su 100.000 €.

## Dove investire

| Zona | Circ. | Intervento | Budget | Persone raggiunte (stima) | Costo per persona | Indice di ritorno atteso | Affidabilità |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Barriera di Milano | 6 | Presidio di prossimità | 50.000 € | 1200 | 41,67 € | 0,042 | ufficiale |

L'indice di ritorno atteso è una stima comparativa, non un risultato misurato. Costi: ipotesi del team, modificabili.

## Perché queste zone

Gli over 75 sono 2300 (stima). I residenti stranieri sono il 28%: un bisogno di accesso e di lingua.

## Cosa è già finanziato

Barriera di Milano ha 120.000 € già finanziati, 3 progetti, quota finanziata 42%.

## Limiti dei dati

Le persone sole sono un valore di Circoscrizione, non di zona. Costi: ipotesi del team, modificabili.

## Fonti

- Censimento ISTAT (2021): https://www.istat.it/censimenti/popolazione
- [Anagrafe del Comune di Torino](http://aperto.comune.torino.it/dataset/popolazione), 2025`;

test("good LLM text gives mode llm, unchanged", async () => {
  useText(GOOD_TEXT);
  const result = await writeMemo(request());
  assert.equal(result.mode, "llm");
  assert.equal(result.markdown, GOOD_TEXT);
});

test("good LLM text after thinking blocks gives mode llm", async () => {
  setClientForTests(
    fakeClient(async () =>
      answer("", "end_turn", [
        { type: "thinking", thinking: "", signature: "x" },
        { type: "text", text: GOOD_TEXT.slice(0, 20) },
        { type: "text", text: GOOD_TEXT.slice(20) },
      ]),
    ),
  );
  const result = await writeMemo(request());
  assert.equal(result.mode, "llm");
  assert.equal(result.markdown, GOOD_TEXT);
});

test("the mock line comes from code on the LLM path", async () => {
  const captured = useText(GOOD_TEXT);
  const result = await writeMemo(request({ mock: true }));
  assert.equal(result.mode, "llm");
  assert.ok(result.markdown.startsWith(`${MOCK_LINE}\n\n## Sintesi`));
  assert.doesNotMatch(JSON.stringify(captured.body), /mock|DATI DI PROVA/);
});

test("a preamble and code fence never reach the user", async () => {
  useText(`Ecco il memo con 999 voci:\n\n\`\`\`markdown\n${GOOD_TEXT}\n\`\`\``);
  const result = await writeMemo(request());
  assert.equal(result.mode, "llm");
  assert.equal(result.markdown, GOOD_TEXT);
});

const BAD_TEXTS: Array<[string, string]> = [
  ["an invented number", GOOD_TEXT.replace("95.000 €", "96.500 €")],
  ["a spelled-out invented number", GOOD_TEXT.replace("Raccomandiamo di partire", "Raccomandiamo diciassette zone, a partire")],
  ["a number from a zone outside the plan", GOOD_TEXT.replace("95.000 €", "987.654 €")],
  ["a missing heading", GOOD_TEXT.replace("## Limiti dei dati\n\n", "")],
  ["headings out of order", GOOD_TEXT.replace("## Sintesi", "## TEMP").replace("## Dove investire", "## Sintesi").replace("## TEMP", "## Dove investire")],
  ["an extra heading", GOOD_TEXT.replace("## Fonti", "## Raccomandazioni\n\nTesto.\n\n## Fonti")],
  ["SROI", GOOD_TEXT.replace("L'indice di ritorno atteso è", "L'indice di ritorno atteso, o SROI, è")],
  ["sroi in lower case", GOOD_TEXT.replace("Costi:", "(sroi) Costi:")],
  ["foreign residents framed as risk", GOOD_TEXT.replace("un bisogno di accesso e di lingua", "un rischio per la zona")],
  ["risk before foreign residents", GOOD_TEXT.replace("I residenti stranieri sono il 28%", "A rischio per i residenti stranieri, il 28%")],
  ["an invented URL", GOOD_TEXT.replace("https://www.istat.it/censimenti/popolazione", "https://www.istat.it/inventato")],
  ["an invented markdown link", GOOD_TEXT.replace("(http://aperto.comune.torino.it/dataset/popolazione)", "(https://esempio.it/x)")],
  ["an invented www link", `${GOOD_TEXT}\n- www.esempio.it/x`],
  ["no indice di ritorno atteso", GOOD_TEXT.replace(/indice di ritorno atteso/gi, "indice")],
  ["a printed null", GOOD_TEXT.replace("1200", "null")],
];

for (const [name, text] of BAD_TEXTS) {
  test(`LLM text with ${name} falls back to the template`, async () => {
    const req = request();
    useText(text);
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      const result = await writeMemo(req);
      assert.equal(result.mode, "rules");
      assert.equal(result.markdown, templateMemo(req));
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /^\[memo\] testo LLM scartato: /);
  });
}

test("the log names the unsupported numbers", async () => {
  useText(GOOD_TEXT.replace("95.000 €", "96.500 €"));
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    await writeMemo(request());
  } finally {
    console.warn = original;
  }
  assert.match(warnings.join("\n"), /numeri non presenti nei dati: 96\.500/);
});

test("the indice di ritorno atteso wording is not demanded of an empty plan", async () => {
  const empty = GOOD_TEXT.replace(/\| Barriera[\s\S]*?\n\n/, "\n").replace(/indice di ritorno atteso/gi, "indice");
  useText(empty.replace("95.000 € su ", ""));
  const req = request({ plan: [] });
  const facts = buildFacts(req);
  assert.ok(!checkMemo(empty, facts).some((failure) => failure.includes("indice di ritorno atteso")));
});

for (const stopReason of ["refusal", "max_tokens", "pause_turn"]) {
  test(`stop_reason ${stopReason} falls back to the template, even with good text`, async () => {
    useText(GOOD_TEXT, stopReason);
    const req = request();
    const result = await writeMemo(req);
    assert.equal(result.mode, "rules");
    assert.equal(result.markdown, templateMemo(req));
  });
}

test("an API error falls back to the template", async () => {
  setClientForTests(
    fakeClient(async () => {
      throw new Error("529 overloaded");
    }),
  );
  const req = request();
  const result = await writeMemo(req);
  assert.equal(result.mode, "rules");
  assert.equal(result.markdown, templateMemo(req));
});

test("a client that throws synchronously falls back to the template", async () => {
  setClientForTests(
    fakeClient(() => {
      throw new Error("sync failure");
    }),
  );
  assert.equal((await writeMemo(request())).mode, "rules");
});

test("a malformed client or response falls back to the template", async () => {
  setClientForTests({} as unknown as Anthropic);
  assert.equal((await writeMemo(request())).mode, "rules");
  setClientForTests(fakeClient(async () => ({ stop_reason: "end_turn" })));
  assert.equal((await writeMemo(request())).mode, "rules");
  setClientForTests(fakeClient(async () => answer("", "end_turn", [{ type: "thinking", thinking: "" }])));
  assert.equal((await writeMemo(request())).mode, "rules");
});

test("a hung client falls back at the timeout and the request is aborted", async () => {
  const captured: Captured = {};
  setClientForTests(
    fakeClient((_body, options) => {
      captured.options = options as Captured["options"];
      return new Promise(() => {});
    }),
  );
  const started = Date.now();
  const req = request();
  const result = await writeMemo(req, { timeoutMs: 30 });
  assert.equal(result.mode, "rules");
  assert.equal(result.markdown, templateMemo(req));
  assert.ok(Date.now() - started < 2000);
  assert.equal(captured.options?.signal?.aborted, true);
  assert.equal(captured.options?.timeout, 30);
});

test("no client gives the template without calling anything", async () => {
  setClientForTests(null);
  const req = request();
  const result = await writeMemo(req);
  assert.equal(result.mode, "rules");
  assert.equal(result.markdown, templateMemo(req));
});

test("writeMemo never rejects, even on garbage", async () => {
  useText(GOOD_TEXT);
  for (const input of [undefined, null, {}, { plan: 1 }] as unknown as MemoRequest[]) {
    const result = await writeMemo(input);
    assert.equal(result.mode, "rules");
    assert.deepEqual(headingsOf(result.markdown), [...MEMO_HEADINGS]);
  }
});

test("the request has the agreed shape and no forbidden parameter", async () => {
  const captured = useText(GOOD_TEXT);
  const req = request();
  await writeMemo(req);
  const body = captured.body ?? {};
  for (const forbidden of ["temperature", "top_p", "top_k", "thinking"]) assert.ok(!(forbidden in body), forbidden);
  assert.deepEqual(Object.keys(body).sort(), ["betas", "fallbacks", "max_tokens", "messages", "model", "output_config", "system"]);
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.fallbacks, "default");
  assert.equal(body.max_tokens, 4000);
  assert.deepEqual(body.output_config, { effort: "low" });
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");
  assert.deepEqual(JSON.parse(messages[0]?.content ?? ""), JSON.parse(JSON.stringify(buildFacts(req))));
  const system = body.system as Array<{ type: string; text: string; cache_control: unknown }>;
  assert.deepEqual(system[0]?.cache_control, { type: "ephemeral" });
  assert.equal(captured.options?.maxRetries, 0);
  assert.equal(captured.options?.timeout, 30000);
  assert.ok(captured.options?.signal instanceof AbortSignal);
});

test("the prompt carries the non-negotiables and the payload stays on the plan", async () => {
  const captured = useText(GOOD_TEXT);
  await writeMemo(request());
  const system = (captured.body?.system as Array<{ text: string }>)[0]?.text ?? "";
  for (const phrase of [
    "indice di ritorno atteso",
    "stima comparativa",
    "ipotesi del team, modificabili",
    "alone_rate_circ è un valore di Circoscrizione",
    "bisogno di accesso e di lingua",
    "Non scrivere numeri in lettere",
    "Non scrivere date",
    ...MEMO_HEADINGS.map((heading) => `## ${heading}`),
  ]) {
    assert.ok(system.includes(phrase), phrase);
  }
  const payload = (captured.body?.messages as Array<{ content: string }>)[0]?.content ?? "";
  assert.ok(!payload.includes("Zona fuori dal piano"));
  assert.ok(!payload.includes("987654"));
});
