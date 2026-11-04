import { describe, expect, it } from 'vitest';
import type { FundedProject, Intervention, Meta, PlanItem, PlannerState, ZoneProps } from '../../types';
import { CONFIDENCE_LABEL } from '../planner/format';
import { parseBlocks } from './Markdown';
import { buildMemoTemplate, chooseMemo, type MemoInput } from './template';

const zone = (over: Partial<ZoneProps> = {}): ZoneProps => ({
  id: 70, name: 'Pilonetto', circ: 8, pop_2025: 3006, over65_est: 790, over75_est: 425,
  adults_50_64_est: 609, over75_2030: 468, alone_rate_circ: 0.349, foreign_share: 0.143,
  isolation: 72, service_gap: 53, future_pressure: 26, inclusion: 11,
  funded_eur: 1886674, funded_projects: 2, funded_share: 0.63,
  nearest: { health_m: 2066, care_m: 2717, pharmacy_m: 310 }, services_800m: 5,
  stability_top10: 0.62, confidence: 'estimated', small_zone: false, ...over,
});

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  zone_id: 70, zone_name: 'Pilonetto', circ: 8, intervention_id: 'visite_domiciliari',
  intervention_label: 'Visite e compagnia a domicilio', budget_eur: 24700, people_reached: 42,
  cost_per_person_eur: 588, return_index: 0.00085,
  scores: { isolation: 72, service_gap: 53, future_pressure: 26, inclusion: 11, funded_share: 0.63 },
  confidence: 'estimated', ...over,
});

const secondZone = zone({
  id: 12, name: 'Barriera di Milano', circ: 6, over75_est: 1210, pop_2025: 12044, over75_2030: null,
  isolation: 88, service_gap: 64, future_pressure: 47, inclusion: 59, funded_eur: 0, funded_projects: 0,
  funded_share: 0, nearest: { health_m: null, care_m: 1450, pharmacy_m: null }, stability_top10: null,
  confidence: 'low',
});

const secondItem = item({
  zone_id: 12, zone_name: 'Barriera di Milano', circ: 6, intervention_id: 'sicurezza_digitale',
  intervention_label: 'Sicurezza digitale e anti-truffa', budget_eur: 11900, people_reached: 223,
  cost_per_person_eur: 53, return_index: 0.0123,
  scores: { isolation: 88, service_gap: 64, future_pressure: 47, inclusion: 59, funded_share: 0 },
  confidence: 'low',
});

const fit = { isolation: 1, service_gap: 1, future_pressure: 1, inclusion: 1 };

const interventions: Intervention[] = [
  { id: 'visite_domiciliari', label: 'Visite e compagnia a domicilio', target: 'over75_est', reach_share: 0.1, fixed_eur: 10000, eur_per_person: 350, depth: 6, fit },
  { id: 'sicurezza_digitale', label: 'Sicurezza digitale e anti-truffa', target: 'over65_est', reach_share: 0.2, fixed_eur: 3000, eur_per_person: 40, depth: 1, fit },
  { id: 'hub_prossimita', label: 'Hub di prossimità e cura', target: 'over65_est', reach_share: 0.15, fixed_eur: 60000, eur_per_person: 80, depth: 3, fit },
];

const funded: FundedProject[] = [
  { id: 1, title: 'Centro anziani | Via Roma', programme: 'PNRR', amount_eur: 950000, progress_pct: 70, circ: 8, zone_id: 70, theme: 'Sociale', source: 'Comune di Torino' },
  { id: 2, title: 'Assistenza di quartiere', programme: 'PNC', amount_eur: 120000, progress_pct: null, circ: 8, zone_id: null, theme: 'Sociale', source: 'Comune di Torino' },
  { id: 3, title: 'Rete cittadina', programme: 'PNRR', amount_eur: 400000, progress_pct: 10, circ: null, zone_id: null, theme: 'Sociale', source: 'Comune di Torino' },
];

const meta: Meta = {
  mock: false,
  generated_at: '2026-11-04T11:15:54.783Z',
  sources: [
    { key: 'pop', label: 'Popolazione per zona statistica', url: 'https://aperto.comune.torino.it/dataset/pop', year: 2025, level: 'zona' },
    { key: 'rsa', label: 'RSA private', url: '', year: 2024, level: 'città' },
  ],
};

const state = (over: Partial<PlannerState> = {}): PlannerState => ({
  profile: 'foundation',
  budget_eur: 100000,
  weights: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  filters: { circ: [], exclude_funded: false, min_over75: 0 },
  selected_zone_id: null,
  plan: [secondItem, item()],
  ...over,
});

const input = (over: Partial<MemoInput> = {}): MemoInput => ({
  state: state(), zones: [zone(), secondZone], meta, funded, interventions, ...over,
});

/** Non-breaking spaces from Intl become plain ones, so expectations stay readable. */
const memoOf = (over: Partial<MemoInput> = {}) => buildMemoTemplate(input(over)).replace(/ /g, ' ');

describe('buildMemoTemplate', () => {
  it('has the six sections, in order, under one title', () => {
    const headings = parseBlocks(memoOf()).flatMap((block) => (block.type === 'heading' ? [block.text] : []));
    expect(headings).toEqual([
      'Memo di finanziamento', 'Sintesi', 'Dove investire', 'Perché queste zone',
      'Cosa è già finanziato', 'Limiti dei dati', 'Fonti',
    ]);
  });

  it('states the budget, the profile and what the plan spends', () => {
    const memo = memoOf();
    expect(memo).toContain('**Budget:** 100.000 €');
    expect(memo).toContain('**Profilo:** Fondazione');
    expect(memo).toContain('**2 interventi** in **2 zone**');
    expect(memo).toContain('impiega **36.600 €**');
    expect(memo).toContain('Restano da assegnare 63.400 €.');
    expect(memo).toContain('circa **265** (stima)');
  });

  it('adds the assumptions note, with the values of the interventions in the plan only', () => {
    const memo = memoOf();
    expect(memo).toContain('beneficio per persona e aderenza ai bisogni sono ipotesi di lavoro del team');
    expect(memo).toContain('Costi e quote si possono modificare nel planner');
    expect(memo).toContain('Visite e compagnia a domicilio: 10% degli over 75, 10.000 € fissi e 350 € a persona');
    expect(memo).not.toContain('Hub di prossimità');
  });

  it('explains the index in the same words as the planner panel', () => {
    expect(memoOf()).toContain("conta le persone raggiunte, pesate per beneficio dell'intervento, bisogno della zona e addizionalità, ogni 1.000 € di costo");
  });

  it('labels estimates in the table, and says what the index is without the forbidden term', () => {
    const memo = memoOf();
    expect(memo).toContain('Persone (stima)');
    expect(memo).toContain('Costo per persona (ipotesi)');
    expect(memo).toContain('Over 75 stimati: 425 su 3.006 residenti');
    expect(memo).toContain('indice di ritorno atteso');
    expect(memo.toLowerCase()).not.toContain('sroi');
  });

  it('shows the return index on the same scale as the planner panel', () => {
    const table = parseBlocks(memoOf()).find((block) => block.type === 'table');
    if (table?.type !== 'table') throw new Error('table missing');
    expect(table.rows.map((row) => row[5])).toEqual(['12,3', '0,9']);
  });

  it('shows the reliability of each zone and names the weak ones', () => {
    const memo = memoOf();
    expect(memo).toContain(`${CONFIDENCE_LABEL.estimated}: 1, ${CONFIDENCE_LABEL.low}: 1`);
    expect(memo).toContain('**Da verificare prima di deliberare:** Barriera di Milano.');
  });

  it('reports funding by zone, per project and beyond the zones', () => {
    const memo = memoOf();
    expect(memo).toContain('| Pilonetto | 1.886.674 € | 2 | 0,63 |');
    expect(memo).toContain('950.000 €, avanzamento 70%');
    expect(memo).toContain('nelle stesse Circoscrizioni 1 progetto, 120.000 €');
    expect(memo).toContain('a livello cittadino 1 progetto, 400.000 €');
    expect(memo).toContain('Fonte dei progetti: Comune di Torino.');
  });

  it('never presents relative coverage as a percentage of need', () => {
    expect(memoOf()).not.toContain('63%');
  });

  it('says so when nothing is funded in the plan zones', () => {
    const unfunded = zone({ funded_eur: 0, funded_projects: 0, funded_share: 0 });
    const plan = [item({ scores: { ...item().scores, funded_share: 0 } })];
    const memo = memoOf({ state: state({ plan }), zones: [unfunded], funded: [] });
    expect(memo).toContain('non risultano progetti già localizzati');
    expect(memo).not.toContain('| Zona | Già finanziato');
  });

  it('treats foreign residents as an access need, never as a risk', () => {
    const memo = memoOf();
    expect(memo).toContain('bisogno di accesso e di lingua, mai un rischio');
    expect(memo).not.toMatch(/stranier[^\n]*(?<!mai un )rischio/);
  });

  it('lists the sources with year and level, and a link only when there is a url', () => {
    const memo = memoOf();
    expect(memo).toContain('- [Popolazione per zona statistica](https://aperto.comune.torino.it/dataset/pop), anno 2025, livello zona');
    expect(memo).toContain('- RSA private, anno 2024, livello città');
    expect(memo).toContain('Dati elaborati il 4 novembre 2026.');
  });

  it('copes with no sources and no metadata', () => {
    const memo = memoOf({ meta: null });
    expect(memo).toContain('Nessuna fonte indicata nei metadati.');
    expect(memo).not.toContain('Dati elaborati');
  });

  it('prints no placeholder for null fields', () => {
    const lone = memoOf({ zones: [secondZone], state: state({ plan: [secondItem] }) });
    expect(lone).not.toMatch(/null|undefined|NaN|Infinity/);
    expect(lone).not.toContain('presidio sanitario');
    expect(lone).not.toContain('stimati al 2030');
    expect(lone).toContain('struttura di cura più vicina a 1.450 m');
  });

  it('still works when the facts of a zone are missing', () => {
    const memo = memoOf({ zones: [] });
    expect(memo).not.toMatch(/null|undefined|NaN/);
    expect(memo).toContain('**Pilonetto** (Circoscrizione 8): isolamento 72');
    expect(memo).toContain('| Pilonetto | n.d. | n.d. | 0,63 |');
  });

  it('flags mock data at the top', () => {
    expect(memoOf({ meta: { ...meta, mock: true } })).toContain('> **Dati di prova:**');
    expect(memoOf()).not.toContain('Dati di prova');
  });

  it('keeps a pipe in a project title inside its table or line', () => {
    const named = item({ zone_name: 'Borgo | Vecchio', intervention_label: 'Visite *a domicilio*' });
    const table = parseBlocks(memoOf({ state: state({ plan: [named] }) }))
      .find((block) => block.type === 'table');
    if (table?.type !== 'table') throw new Error('table missing');
    expect(table.rows[0]).toHaveLength(7);
    expect(table.rows[0][0]).toBe('Borgo \\| Vecchio (Circ. 8)');
  });

  it('uses only figures from the input, or sums of input figures', () => {
    // Everything the data can legitimately put in this memo, as it is printed.
    const allowed = new Set([
      // Budget, spend, what is left and the people total, the only derived figures.
      '100.000', '36.600', '63.400', '265',
      // Plan rows.
      '24.700', '42', '588', '11.900', '223', '53', '12,3', '0,9', '8', '6', '2',
      // Zone facts.
      '425', '3.006', '468', '1.210', '12.044', '34,9', '5', '2.066', '2.717', '310', '1.450', '62',
      '72', '26', '11', '88', '64', '47', '59', '1.886.674', '0,63', '0', '0,00',
      // Weights, interventions and projects.
      '40', '30', '20', '10', '10.000', '350', '3.000', '950.000', '70', '120.000', '400.000', '1',
      // Fixed labels: score and coverage scales, field names, index unit, source years and date.
      '100', '800', '65', '75', '50-64', '2030', '1.000', '2025', '2024', '4', '2026',
    ]);
    const figures = memoOf({ meta: { ...meta, sources: meta.sources.map((s) => ({ ...s, url: '' })) } })
      .match(/\d+(?:[.,-]\d+)*/g) ?? [];
    expect(figures.filter((figure) => !allowed.has(figure))).toEqual([]);
  });

  it('is deterministic and leaves its input untouched', () => {
    const frozen = input();
    const snapshot = JSON.stringify(frozen);
    expect(buildMemoTemplate(frozen)).toBe(buildMemoTemplate(frozen));
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  describe('with an empty plan', () => {
    const empty = (over: Partial<PlannerState> = {}) => memoOf({ state: state({ plan: [], ...over }), zones: [] });

    it('explains what to do instead of writing a memo', () => {
      const memo = empty();
      expect(memo).toContain('# Memo non ancora disponibile');
      expect(memo).toContain('Il piano è vuoto');
      expect(memo).toContain('chiedi di nuovo il memo');
      expect(memo).not.toContain('## Sintesi');
    });

    it('points at the budget or at the active filters', () => {
      expect(empty({ budget_eur: 0 })).toContain('Imposta un budget maggiore di zero');
      expect(empty()).toContain('con 100.000 € potrebbe non esserci spazio');
      const filtered = empty({ filters: { circ: [6], exclude_funded: true, min_over75: 500 } });
      expect(filtered).toContain('Allenta i filtri attivi (Circoscrizione 6 · senza zone finanziate · almeno 500 over 75)');
    });
  });
});

describe('chooseMemo', () => {
  const template = 'memo locale';

  it('keeps the server text and says who wrote it', () => {
    expect(chooseMemo({ ok: true, data: { markdown: '# Testo', mode: 'llm' } }, template))
      .toEqual({ markdown: '# Testo', notice: 'Testo redatto dall\'AI sui dati del piano.' });
    expect(chooseMemo({ ok: true, data: { markdown: '# Testo', mode: 'rules' } }, template).notice)
      .toContain('Testo standard del server');
  });

  it('falls back to the template on any failure, and says why', () => {
    const chosen = chooseMemo({ ok: false, reason: 'offline', message: 'Il server AI non è raggiungibile.' }, template);
    expect(chosen.markdown).toBe(template);
    expect(chosen.notice).toBe('Il server AI non è raggiungibile. Memo generato in locale dai dati del piano.');
  });

  it('refuses a server text that uses the forbidden term', () => {
    const chosen = chooseMemo({ ok: true, data: { markdown: 'Uno SROI di 3', mode: 'llm' } }, template);
    expect(chosen.markdown).toBe(template);
  });

  it('removes a code fence wrapped around the whole memo', () => {
    const chosen = chooseMemo({ ok: true, data: { markdown: '```markdown\n# Testo\n```\n', mode: 'llm' } }, template);
    expect(chosen.markdown).toBe('# Testo');
  });
});
