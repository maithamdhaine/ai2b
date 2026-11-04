import { copyFor, interventionLabel, type Lang } from '../../i18n';
import type { ApiResult } from '../../lib/api';
import { longDate } from '../../lib/intl';
import type {
  Confidence, FundedProject, Intervention, MemoResponse, Meta, PlanItem, PlannerState,
  Weights, ZoneProps,
} from '../../types';
import { formatFixed, formatMeters, formatPercentage, formatShare, isNumber, notAvailable } from '../map/format';
import {
  INDEX_SCALE, confidenceLabels, criteriaList, filtersRecap, formatEur, formatInt,
  formatReturnIndex, hasActiveFilters, summarisePlan, targetLabels, weightShares,
} from '../planner/format';

export interface MemoInput {
  state: PlannerState;
  /** Facts of the zones in the plan. */
  zones: ZoneProps[];
  meta: Meta | null;
  funded: FundedProject[];
  interventions: Intervention[];
  lang: Lang;
}

// Keeps the memo near one page. The full plan is always in the "where to invest" table.
const MAX_ZONE_DETAILS = 8;
const MAX_PROJECTS = 5;

/** Data text goes into Markdown, so a "|" in a project title must not split a table row. */
const esc = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]|]/g, '\\$&');

const present = <T,>(values: (T | null)[]) => values.filter((value): value is T => value !== null);

const counted = (count: number, word: (n: number) => string) => `${formatInt(count)} ${word(count)}`;

export const describeWeights = (weights: Weights, lang: Lang) => {
  const shares = weightShares(weights);
  return criteriaList(lang)
    .map(({ key, label }) => `${label.toLowerCase()} ${shares[key]}%`)
    .join(', ');
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

function header({ state, meta, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const lines = [
    `# ${t.title}`,
    `**${t.profile}:** ${copyFor(lang).planner.profiles[state.profile]} · `
      + `**${t.budget}:** ${formatEur(state.budget_eur)}`,
  ];
  if (meta?.mock) lines.push(`> ${t.mockWarning}`);
  return lines.join('\n\n');
}

function summary({ state, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const { plan, budget_eur: budget } = state;
  const { used_eur: used, people, zones, overlapping_zones: overlapping } = summarisePlan(plan);
  const first = plan[0];
  const unassigned = budget - used;

  return [
    t.sections.summary,
    present([
      t.summaryOpening(
        formatEur(budget),
        counted(plan.length, t.interventionsPlural),
        counted(zones, t.zonesPlural),
        formatEur(used),
      ),
      unassigned >= 1 ? t.unassigned(formatEur(unassigned)) : null,
      t.peopleReached(formatInt(people)),
      overlapping ? copyFor(lang).planner.overlapNote.trim() : null,
      t.firstPriority(
        esc(interventionLabel(first.intervention_id, first.intervention_label, lang)),
        esc(first.zone_name),
        first.circ,
        formatEur(first.budget_eur),
        formatInt(first.people_reached),
      ),
    ]).join(' '),
  ].join('\n\n');
}

function assumptionsNote({ state, interventions, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const targets = targetLabels(lang);
  const used = interventions
    .filter(({ id }) => state.plan.some((item) => item.intervention_id === id))
    .map(({ id, label, target, reach_share: reach, fixed_eur: fixed, eur_per_person: perPerson }) => (
      t.valuesLine(
        esc(interventionLabel(id, label, lang)), formatShare(reach), targets[target],
        formatEur(fixed), formatEur(perPerson),
      )
    ));
  return used.length > 0
    ? `${t.assumptionsNote} ${t.valuesUsed} ${used.join('; ')}.`
    : t.assumptionsNote;
}

function whereToInvest(input: MemoInput): string {
  const t = copyFor(input.lang).memo;
  const labels = confidenceLabels(input.lang);
  const rows = input.state.plan.map((item) => [
    `${esc(item.zone_name)} (Circ. ${item.circ})`,
    esc(interventionLabel(item.intervention_id, item.intervention_label, input.lang)),
    formatEur(item.budget_eur),
    formatInt(item.people_reached),
    formatEur(item.cost_per_person_eur),
    formatReturnIndex(item.return_index),
    labels[item.confidence],
  ]);
  return [
    t.sections.where,
    [
      `| ${t.tableHead.join(' | ')} |`,
      '| --- | --- | ---: | ---: | ---: | ---: | --- |',
      ...rows.map((cells) => `| ${cells.join(' | ')} |`),
    ].join('\n'),
    assumptionsNote(input),
  ].join('\n\n');
}

function zoneDetail(item: PlanItem, zone: ZoneProps | undefined, lang: Lang): string {
  const t = copyFor(lang).memo;
  const scores = zone ?? item.scores;
  const needs = criteriaList(lang)
    .map(({ key, label }) => `${label.toLowerCase()} ${formatInt(scores[key])}`)
    .join(', ');
  const head = t.zoneDetailHead(esc(item.zone_name), item.circ, needs);
  if (!zone) return head;

  const { health_m: health, care_m: care, pharmacy_m: pharmacy } = zone.nearest ?? {};
  const facts = present([
    t.over75Of(formatInt(zone.over75_est), formatInt(zone.pop_2025)),
    isNumber(zone.over75_2030) ? t.over75By2030(formatInt(zone.over75_2030)) : null,
    t.aloneShare(formatShare(zone.alone_rate_circ)),
    t.servicesWithin(formatInt(zone.services_800m)),
    isNumber(health) ? t.nearestHealth(formatMeters(health)) : null,
    isNumber(care) ? t.nearestCare(formatMeters(care)) : null,
    isNumber(pharmacy) ? t.nearestPharmacy(formatMeters(pharmacy)) : null,
    isNumber(zone.stability_top10) ? t.stability(formatShare(zone.stability_top10)) : null,
  ]);
  return `${head} ${facts.join('; ')}.`;
}

function whyTheseZones({ state, zones, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const byId = zoneLookup(zones);
  const items = firstItemPerZone(state.plan);
  const shown = items.slice(0, MAX_ZONE_DETAILS);
  const hidden = items.length - shown.length;

  return present([
    t.sections.why,
    t.indexExplained(formatEur(INDEX_SCALE)),
    t.weightsLine(describeWeights(state.weights, lang), filtersRecap(state.filters, lang)),
    shown.map((item) => zoneDetail(item, byId.get(item.zone_id), lang)).join('\n'),
    hidden > 0 ? t.moreZones(formatInt(hidden)) : null,
  ]).join('\n\n');
}

const totalOf = (projects: FundedProject[]) =>
  formatEur(projects.reduce((sum, project) => sum + project.amount_eur, 0));

function projectList(items: PlanItem[], funded: FundedProject[], lang: Lang): string | null {
  const t = copyFor(lang).memo;
  const names = new Map(items.map((item) => [item.zone_id, item.zone_name]));
  const projects = funded
    .filter(({ zone_id: id }) => id !== null && names.has(id))
    .sort((a, b) => b.amount_eur - a.amount_eur);
  if (projects.length === 0) return null;

  const listed = projects.slice(0, MAX_PROJECTS);
  const lines = listed.map(({ title, zone_id: id, programme, amount_eur: amount, progress_pct: progress }) => {
    const advancement = isNumber(progress) ? t.progressSuffix(formatPercentage(progress)) : '';
    return t.projectLine(
      esc(title), esc(names.get(id as number) ?? ''), esc(programme), formatEur(amount), advancement,
    );
  });
  const others = projects.length - listed.length;
  const sources = [...new Set(listed.map(({ source }) => source).filter(Boolean))].map(esc);

  return present([
    lines.join('\n'),
    present([
      others > 0 ? t.moreProjects(formatInt(others)) : null,
      sources.length > 0 ? t.projectSource(sources.join(', ')) : null,
    ]).join(' ') || null,
  ]).join('\n\n');
}

function widerProjects(items: PlanItem[], funded: FundedProject[], lang: Lang): string | null {
  const t = copyFor(lang).memo;
  const circs = new Set(items.map(({ circ }) => circ));
  const inCirc = funded.filter(({ zone_id: id, circ }) => id === null && circ !== null && circs.has(circ));
  const citywide = funded.filter(({ zone_id: id, circ }) => id === null && circ === null);
  const parts = present([
    inCirc.length > 0 ? t.inSameCirc(counted(inCirc.length, t.projectsPlural), totalOf(inCirc)) : null,
    citywide.length > 0 ? t.citywide(counted(citywide.length, t.projectsPlural), totalOf(citywide)) : null,
  ]);
  return parts.length > 0 ? t.notPlaced(parts.join('; ')) : null;
}

function alreadyFunded({ state, zones, funded, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
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
      zone ? formatEur(zone.funded_eur) : notAvailable(),
      zone ? formatInt(zone.funded_projects) : notAvailable(),
      formatFixed(zone?.funded_share ?? item.scores.funded_share, 2),
    ];
  });

  return present([
    t.sections.funded,
    rows.length > 0 ? t.coverageScale : t.noLocalProjects,
    rows.length > 0
      ? [
        `| ${t.fundedTableHead.join(' | ')} |`,
        '| --- | ---: | ---: | ---: |',
        ...rows.map((cells) => `| ${cells.join(' | ')} |`),
      ].join('\n')
      : null,
    projectList(items, funded, lang),
    widerProjects(items, funded, lang),
  ]).join('\n\n');
}

function dataLimits({ state, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const labels = confidenceLabels(lang);
  const items = firstItemPerZone(state.plan);
  const levels: Confidence[] = ['official', 'estimated', 'low'];
  const reliability = levels
    .map((level) => ({ level, count: items.filter((item) => item.confidence === level).length }))
    .filter(({ count }) => count > 0)
    .map(({ level, count }) => `${labels[level]}: ${formatInt(count)}`);
  const weak = items.filter((item) => item.confidence === 'low').map((item) => esc(item.zone_name));

  return [
    t.sections.limits,
    present([
      ...t.limits,
      t.reliability(reliability.join(', ')),
      weak.length > 0 ? t.toVerify(weak.join(', ')) : null,
    ]).join('\n'),
  ].join('\n\n');
}

function dataDate(meta: Meta | null): string | null {
  const time = Date.parse(meta?.generated_at ?? '');
  if (Number.isNaN(time)) return null;
  return longDate().format(time);
}

const linkTarget = (url: string) => encodeURI(url.trim()).replace(/\(/g, '%28').replace(/\)/g, '%29');

function sources({ meta, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const entries = (meta?.sources ?? []).map(({ label, url, year, level }) => {
    const name = url ? `[${esc(label)}](${linkTarget(url)})` : esc(label);
    return `- ${present([
      name,
      isNumber(year) && year > 0 ? t.year(year) : null,
      level ? t.level(esc(level)) : null,
    ]).join(', ')}`;
  });
  const processed = dataDate(meta);

  return present([
    t.sections.sources,
    [...(entries.length > 0 ? entries : [t.noSources]), t.teamAssumptions].join('\n'),
    processed ? t.processedOn(processed) : null,
  ]).join('\n\n');
}

function emptyPlanMemo({ state, lang }: MemoInput): string {
  const t = copyFor(lang).memo;
  const { budget_eur: budget, filters } = state;
  const steps = present([
    budget > 0 ? t.emptyBudget(formatEur(budget)) : t.emptyNoBudget,
    hasActiveFilters(filters) ? t.emptyFilters(filtersRecap(filters, lang)) : null,
    t.emptyThenAsk,
  ]);
  return [
    t.emptyTitle,
    t.emptyIntro,
    t.emptySteps,
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

const WRAPPED_IN_FENCE = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/i;

/** The server's text when it is usable, otherwise the template. */
export function chooseMemo(result: ApiResult<MemoResponse>, template: string, lang: Lang): ChosenMemo {
  const t = copyFor(lang).memo;
  if (!result.ok) return { markdown: template, notice: `${result.message} ${t.localMemo}` };

  const { markdown, mode } = result.data;
  // The output must always be called "expected return index", so this term never reaches the board.
  if (/sroi/i.test(markdown)) {
    return { markdown: template, notice: `${t.forbiddenTerm} ${t.localMemo}` };
  }
  return {
    markdown: WRAPPED_IN_FENCE.exec(markdown)?.[1] ?? markdown,
    notice: mode === 'llm' ? t.byAi : t.byRules,
  };
}
