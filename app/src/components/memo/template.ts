import type { ApiResult } from '../../lib/api';
import type {
  Confidence, FundedProject, Intervention, MemoResponse, Meta, PlanItem, PlannerState, Profile,
  Weights, ZoneProps,
} from '../../types';
import { formatFixed, formatMeters, formatPercentage, formatShare, isNumber } from '../map/format';
import {
  CONFIDENCE_LABEL, CRITERIA, INDEX_SCALE, TARGET_LABEL, filtersRecap, formatEur, formatInt,
  formatReturnIndex, hasActiveFilters, summarisePlan, weightShares,
} from '../planner/format';

export interface MemoInput {
  state: PlannerState;
  /** Facts of the zones in the plan. */
  zones: ZoneProps[];
  meta: Meta | null;
  funded: FundedProject[];
  interventions: Intervention[];
}

export const PROFILE_LABELS: Record<Profile, string> = {
  foundation: 'Fondazione',
  third_sector: 'Terzo settore',
  institution: 'Istituzione',
};

// Keeps the memo near one page. The full plan is always in the "Dove investire" table.
const MAX_ZONE_DETAILS = 8;
const MAX_PROJECTS = 5;

/** Data text goes into Markdown, so a "|" in a project title must not split a table row. */
const esc = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]|]/g, '\\$&');

const counted = (count: number, one: string, many: string) =>
  `${formatInt(count)} ${count === 1 ? one : many}`;

const present = <T,>(values: (T | null)[]) => values.filter((value): value is T => value !== null);

export const describeWeights = (weights: Weights) => {
  const shares = weightShares(weights);
  return CRITERIA.map(({ key, label }) => `${label.toLowerCase()} ${shares[key]}%`).join(', ');
};

/** The plan is ranked, so this keeps each zone's best item, in rank order. */
function firstItemPerZone(plan: PlanItem[]): PlanItem[] {
  const seen = new Set<number>();
  return plan.filter(({ zone_id: id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const zoneLookup = (zones: ZoneProps[]) => new Map(zones.map((zone) => [zone.id, zone]));

function header({ state, meta }: MemoInput): string {
  const lines = [
    '# Memo di finanziamento',
    `**Profilo:** ${PROFILE_LABELS[state.profile]} · **Budget:** ${formatEur(state.budget_eur)}`,
  ];
  if (meta?.mock) {
    lines.push('> **Dati di prova:** le cifre di questo memo sono simulate. Non usarle per decisioni reali.');
  }
  return lines.join('\n\n');
}

function summary({ state }: MemoInput): string {
  const { plan, budget_eur: budget } = state;
  const { used_eur: used, people, zones, overlapping_zones: overlapping } = summarisePlan(plan);
  const first = plan[0];
  const unassigned = budget - used;

  const opening = `Con un budget di **${formatEur(budget)}** il piano propone `
    + `**${counted(plan.length, 'intervento', 'interventi')}** in **${counted(zones, 'zona', 'zone')}** `
    + `di Torino e impiega **${formatEur(used)}**.`;
  return [
    '## Sintesi',
    present([
      opening,
      unassigned >= 1 ? `Restano da assegnare ${formatEur(unassigned)}.` : null,
      `Le persone raggiunte sono circa **${formatInt(people)}** (stima).`,
      overlapping ? 'Nelle zone con più interventi la stessa persona può essere contata più volte.' : null,
      `Prima priorità: **${esc(first.intervention_label)}** a **${esc(first.zone_name)}** `
        + `(Circoscrizione ${first.circ}), con ${formatEur(first.budget_eur)} `
        + `per circa ${formatInt(first.people_reached)} persone.`,
    ]).join(' '),
  ].join('\n\n');
}

function assumptionsNote({ state, interventions }: MemoInput): string {
  const note = '**Nota sulle ipotesi:** costi, quote di persone raggiunte, beneficio per persona e '
    + 'aderenza ai bisogni sono ipotesi di lavoro del team, non preventivi né dati misurati. '
    + 'Costi e quote si possono modificare nel planner. '
    + 'Per questo persone raggiunte e costo per persona sono stime.';
  const used = interventions
    .filter(({ id }) => state.plan.some((item) => item.intervention_id === id))
    .map(({ label, target, reach_share: reach, fixed_eur: fixed, eur_per_person: perPerson }) => (
      `${esc(label)}: ${formatShare(reach)} degli ${TARGET_LABEL[target]}, `
      + `${formatEur(fixed)} fissi e ${formatEur(perPerson)} a persona`
    ));
  return used.length > 0 ? `${note} **Valori usati.** ${used.join('; ')}.` : note;
}

function whereToInvest(input: MemoInput): string {
  const rows = input.state.plan.map((item) => [
    `${esc(item.zone_name)} (Circ. ${item.circ})`,
    esc(item.intervention_label),
    formatEur(item.budget_eur),
    formatInt(item.people_reached),
    formatEur(item.cost_per_person_eur),
    formatReturnIndex(item.return_index),
    CONFIDENCE_LABEL[item.confidence],
  ]);
  return [
    '## Dove investire',
    [
      '| Zona | Intervento | Budget | Persone (stima) | Costo per persona (ipotesi) | Indice di ritorno atteso | Dati |',
      '| --- | --- | ---: | ---: | ---: | ---: | --- |',
      ...rows.map((cells) => `| ${cells.join(' | ')} |`),
    ].join('\n'),
    assumptionsNote(input),
  ].join('\n\n');
}

function zoneDetail(item: PlanItem, zone: ZoneProps | undefined): string {
  const scores = zone ?? item.scores;
  const needs = CRITERIA.map(({ key, label }) => `${label.toLowerCase()} ${formatInt(scores[key])}`);
  const head = `- **${esc(item.zone_name)}** (Circoscrizione ${item.circ}): ${needs.join(', ')}.`;
  if (!zone) return head;

  const { health_m: health, care_m: care, pharmacy_m: pharmacy } = zone.nearest ?? {};
  const facts = present([
    `Over 75 stimati: ${formatInt(zone.over75_est)} su ${formatInt(zone.pop_2025)} residenti`,
    isNumber(zone.over75_2030) ? `${formatInt(zone.over75_2030)} stimati al 2030` : null,
    `vive solo il ${formatShare(zone.alone_rate_circ)} (dato di Circoscrizione)`,
    `servizi entro 800 m: ${formatInt(zone.services_800m)}`,
    isNumber(health) ? `presidio sanitario più vicino a ${formatMeters(health)}` : null,
    isNumber(care) ? `struttura di cura più vicina a ${formatMeters(care)}` : null,
    isNumber(pharmacy) ? `farmacia più vicina a ${formatMeters(pharmacy)}` : null,
    isNumber(zone.stability_top10)
      ? `resta tra le prime 10 con pesi casuali nel ${formatShare(zone.stability_top10)} dei casi`
      : null,
  ]);
  return `${head} ${facts.join('; ')}.`;
}

function whyTheseZones({ state, zones }: MemoInput): string {
  const byId = zoneLookup(zones);
  const items = firstItemPerZone(state.plan);
  const shown = items.slice(0, MAX_ZONE_DETAILS);
  const hidden = items.length - shown.length;
  const { index_out_of_order: outOfOrder } = summarisePlan(state.plan);

  return present([
    '## Perché queste zone',
    'Le coppie zona-intervento sono ordinate per **indice di ritorno atteso**: conta le persone '
      + "raggiunte, pesate per beneficio dell'intervento, bisogno della zona e addizionalità, "
      + `ogni ${formatEur(INDEX_SCALE)} di costo. `
      + 'È una stima per confrontare le opzioni, non un ritorno misurato.'
      + (outOfOrder ? " L'ordine segue l'intervento completo: se i fondi lo riducono, l'indice mostrato scende." : ''),
    `**Pesi del bisogno:** ${describeWeights(state.weights)}. **Filtri:** ${filtersRecap(state.filters)}. `
      + 'I punteggi vanno da 0 a 100: più alto significa più bisogno.',
    shown.map((item) => zoneDetail(item, byId.get(item.zone_id))).join('\n'),
    hidden > 0 ? `Le altre ${formatInt(hidden)} zone del piano sono nella tabella qui sopra.` : null,
  ]).join('\n\n');
}

const totalOf = (projects: FundedProject[]) =>
  formatEur(projects.reduce((sum, project) => sum + project.amount_eur, 0));

function projectList(items: PlanItem[], funded: FundedProject[]): string | null {
  const names = new Map(items.map((item) => [item.zone_id, item.zone_name]));
  const projects = funded
    .filter(({ zone_id: id }) => id !== null && names.has(id))
    .sort((a, b) => b.amount_eur - a.amount_eur);
  if (projects.length === 0) return null;

  const listed = projects.slice(0, MAX_PROJECTS);
  const lines = listed.map(({ title, zone_id: id, programme, amount_eur: amount, progress_pct: progress }) => {
    const advancement = isNumber(progress) ? `, avanzamento ${formatPercentage(progress)}` : '';
    return `- **${esc(title)}** (${esc(names.get(id as number) ?? '')}, ${esc(programme)}): `
      + `${formatEur(amount)}${advancement}.`;
  });
  const others = projects.length - listed.length;
  const sources = [...new Set(listed.map(({ source }) => source).filter(Boolean))].map(esc);

  return present([
    lines.join('\n'),
    present([
      others > 0 ? `Nelle stesse zone ci sono altri ${formatInt(others)} progetti.` : null,
      sources.length > 0 ? `Fonte dei progetti: ${sources.join(', ')}.` : null,
    ]).join(' ') || null,
  ]).join('\n\n');
}

function widerProjects(items: PlanItem[], funded: FundedProject[]): string | null {
  const circs = new Set(items.map(({ circ }) => circ));
  const inCirc = funded.filter(({ zone_id: id, circ }) => id === null && circ !== null && circs.has(circ));
  const citywide = funded.filter(({ zone_id: id, circ }) => id === null && circ === null);
  const parts = present([
    inCirc.length > 0
      ? `nelle stesse Circoscrizioni ${counted(inCirc.length, 'progetto', 'progetti')}, ${totalOf(inCirc)}`
      : null,
    citywide.length > 0
      ? `a livello cittadino ${counted(citywide.length, 'progetto', 'progetti')}, ${totalOf(citywide)}`
      : null,
  ]);
  return parts.length > 0 ? `Non attribuiti a una singola zona: ${parts.join('; ')}.` : null;
}

function alreadyFunded({ state, zones, funded }: MemoInput): string {
  const byId = zoneLookup(zones);
  const items = firstItemPerZone(state.plan);
  const fundedItems = items.filter((item) => {
    const zone = byId.get(item.zone_id);
    return item.scores.funded_share > 0 || (zone !== undefined && (zone.funded_eur > 0 || zone.funded_projects > 0));
  });
  const rows = fundedItems.map((item) => {
    const zone = byId.get(item.zone_id);
    return [
      esc(item.zone_name),
      zone ? formatEur(zone.funded_eur) : 'n.d.',
      zone ? formatInt(zone.funded_projects) : 'n.d.',
      formatFixed(zone?.funded_share ?? item.scores.funded_share, 2),
    ];
  });

  return present([
    '## Cosa è già finanziato',
    rows.length > 0
      ? 'La copertura relativa va da 0 (nessun finanziamento) a 1 (la zona più finanziata per residente).'
      : 'Nelle zone del piano non risultano progetti già localizzati.',
    rows.length > 0
      ? [
        '| Zona | Già finanziato | Progetti | Copertura relativa |',
        '| --- | ---: | ---: | ---: |',
        ...rows.map((cells) => `| ${cells.join(' | ')} |`),
      ].join('\n')
      : null,
    projectList(items, funded),
    widerProjects(items, funded),
  ]).join('\n\n');
}

function dataLimits({ state }: MemoInput): string {
  const items = firstItemPerZone(state.plan);
  const levels: Confidence[] = ['official', 'estimated', 'low'];
  const reliability = levels
    .map((level) => ({ level, count: items.filter((item) => item.confidence === level).length }))
    .filter(({ count }) => count > 0)
    .map(({ level, count }) => `${CONFIDENCE_LABEL[level]}: ${formatInt(count)}`);
  const weak = items.filter((item) => item.confidence === 'low').map((item) => esc(item.zone_name));

  return [
    '## Limiti dei dati',
    present([
      '- **Popolazione per età:** over 65, over 75 e adulti 50-64 sono stime per zona, non conteggi ufficiali.',
      '- **Persone che vivono sole:** il dato è di Circoscrizione e copre tutte le età, quindi è uguale in tutte le zone della stessa Circoscrizione.',
      '- **Pressione futura:** è un segnale relativo, non una previsione, perché non considera migrazioni e decessi.',
      '- **Finanziamenti:** i progetti non localizzabili restano a livello cittadino. La copertura relativa confronta le zone tra loro: non dice quanta parte del bisogno è coperta.',
      '- **Inclusione:** la quota di residenti stranieri indica un bisogno di accesso e di lingua, mai un rischio.',
      '- **Zone piccole:** sono escluse dalla classifica perché le stime sarebbero instabili.',
      `- **Affidabilità delle zone del piano:** ${reliability.join(', ')}.`,
      weak.length > 0 ? `- **Da verificare prima di deliberare:** ${weak.join(', ')}.` : null,
    ]).join('\n'),
  ].join('\n\n');
}

function dataDate(meta: Meta | null): string | null {
  const time = Date.parse(meta?.generated_at ?? '');
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeZone: 'UTC' }).format(time);
}

const linkTarget = (url: string) => encodeURI(url.trim()).replace(/\(/g, '%28').replace(/\)/g, '%29');

function sources({ meta }: MemoInput): string {
  const entries = (meta?.sources ?? []).map(({ label, url, year, level }) => {
    const name = url ? `[${esc(label)}](${linkTarget(url)})` : esc(label);
    return `- ${present([
      name,
      isNumber(year) && year > 0 ? `anno ${year}` : null,
      level ? `livello ${esc(level)}` : null,
    ]).join(', ')}`;
  });
  const processed = dataDate(meta);

  return present([
    '## Fonti',
    [
      ...(entries.length > 0 ? entries : ['- Nessuna fonte indicata nei metadati.']),
      '- Costi, quote, beneficio per persona e aderenza ai bisogni: ipotesi di lavoro del team.',
    ].join('\n'),
    processed ? `Dati elaborati il ${processed}.` : null,
  ]).join('\n\n');
}

function emptyPlanMemo({ state }: MemoInput): string {
  const { budget_eur: budget, filters } = state;
  const steps = present([
    budget > 0
      ? `Controlla il budget: con ${formatEur(budget)} potrebbe non esserci spazio per nessun intervento. Prova ad aumentarlo.`
      : 'Imposta un budget maggiore di zero, nel pannello a destra o scrivendolo nella barra in alto.',
    hasActiveFilters(filters) ? `Allenta i filtri attivi (${filtersRecap(filters)}).` : null,
    'Quando il portafoglio proposto compare nel pannello a destra, chiedi di nuovo il memo.',
  ]);
  return [
    '# Memo non ancora disponibile',
    'Il piano è vuoto, quindi non c\'è ancora nulla da presentare al consiglio.',
    'Per generare il memo:',
    steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
  ].join('\n\n');
}

/**
 * The memo used when the server is off or fails, and the guidance shown for an empty plan.
 * Pure and deterministic: every figure comes from the input, or is a sum of input values.
 */
export function buildMemoTemplate(input: MemoInput): string {
  if (input.state.plan.length === 0) return emptyPlanMemo(input);
  return [
    header(input), summary(input), whereToInvest(input), whyTheseZones(input),
    alreadyFunded(input), dataLimits(input), sources(input),
  ].join('\n\n');
}

export interface ChosenMemo {
  markdown: string;
  notice: string;
}

const LOCAL_MEMO = 'Memo generato in locale dai dati del piano.';
const WRAPPED_IN_FENCE = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/i;

/** The server's text when it is usable, otherwise the template. */
export function chooseMemo(result: ApiResult<MemoResponse>, template: string): ChosenMemo {
  if (!result.ok) return { markdown: template, notice: `${result.message} ${LOCAL_MEMO}` };

  const { markdown, mode } = result.data;
  // The output must always be called "indice di ritorno atteso", so this term never reaches the board.
  if (/sroi/i.test(markdown)) {
    return { markdown: template, notice: `Il testo del server usava un termine non ammesso. ${LOCAL_MEMO}` };
  }
  return {
    markdown: WRAPPED_IN_FENCE.exec(markdown)?.[1] ?? markdown,
    notice: mode === 'llm'
      ? 'Testo redatto dall\'AI sui dati del piano.'
      : 'Testo standard del server, basato sui dati del piano.',
  };
}
