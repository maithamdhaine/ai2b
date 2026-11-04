import { copyFor, type Lang } from '../../i18n';
import { nf } from '../../lib/intl';
import type { Filters, PlanItem, Weights } from '../../types';

// it-IT leaves four-digit numbers ungrouped by default ("9500"), which would sit
// badly next to "12.000" in the same column, so grouping is forced everywhere.
const grouping = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
const intOptions: Intl.NumberFormatOptions = { ...grouping, maximumFractionDigits: 0 };
const eurOptions: Intl.NumberFormatOptions = {
  ...grouping, style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
};
const indexOptions: Intl.NumberFormatOptions = {
  ...grouping, minimumFractionDigits: 1, maximumFractionDigits: 1,
};

const MISSING = '—';

export const formatInt = (n: number) => (Number.isFinite(n) ? nf(intOptions).format(n) : MISSING);
export const formatEur = (n: number) => (Number.isFinite(n) ? nf(eurOptions).format(n) : MISSING);

/**
 * The raw return_index is a value per euro (about 0,001 to 0,02), unreadable on a projector.
 * It is shown per 1.000 euro, which keeps every comparison and gives the number a plain meaning.
 */
export const INDEX_SCALE = 1000;
export const formatReturnIndex = (rawIndex: number) =>
  (Number.isFinite(rawIndex) ? nf(indexOptions).format(rawIndex * INDEX_SCALE) : MISSING);

export type Criterion = keyof Weights;

/** The four criteria, always in this order. Their names come from the language. */
export const CRITERIA: Criterion[] = ['isolation', 'service_gap', 'future_pressure', 'inclusion'];

export const criteriaList = (lang: Lang): { key: Criterion; label: string }[] => {
  const { criteria } = copyFor(lang).planner;
  return CRITERIA.map((key) => ({ key, label: criteria[key] }));
};

export const confidenceLabels = (lang: Lang) => copyFor(lang).planner.confidence;
export const targetLabels = (lang: Lang) => copyFor(lang).planner.targets;

export const allWeightsZero = (weights: Weights) => CRITERIA.every((key) => !(weights[key] > 0));

/**
 * Each weight as a whole percentage of the total, always adding up to 100.
 * With every weight at zero the plan counts the four criteria equally (see
 * lib/planner.ts), so that is what is reported here too.
 */
export function weightShares(weights: Weights): Record<Criterion, number> {
  if (allWeightsZero(weights)) {
    return { isolation: 25, service_gap: 25, future_pressure: 25, inclusion: 25 };
  }
  const total = CRITERIA.reduce((sum, key) => sum + weights[key], 0);
  const exact = CRITERIA.map((key) => (weights[key] / total) * 100);
  const shares = exact.map(Math.floor);
  const missing = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  byRemainder.slice(0, missing).forEach(({ index }) => { shares[index] += 1; });

  return {
    isolation: shares[0], service_gap: shares[1], future_pressure: shares[2], inclusion: shares[3],
  };
}

// The budget slider has two equal halves: 10.000 to 100.000 in steps of 1.000, then
// 100.000 to 1.000.000 in steps of 10.000. On a linear track the default of 100.000
// would sit at 9% of the width, and the range people actually use would be a few pixels.
export const BUDGET_MIN = 10_000;
export const BUDGET_MID = 100_000;
export const BUDGET_MAX = 1_000_000;
const LOW_STEP = 1_000;
const HIGH_STEP = 10_000;
const MID_POSITION = (BUDGET_MID - BUDGET_MIN) / LOW_STEP;
export const BUDGET_POSITIONS = MID_POSITION + (BUDGET_MAX - BUDGET_MID) / HIGH_STEP;

export function budgetToPosition(eur: number): number {
  const position = eur <= BUDGET_MID
    ? (eur - BUDGET_MIN) / LOW_STEP
    : MID_POSITION + (eur - BUDGET_MID) / HIGH_STEP;
  return Math.min(BUDGET_POSITIONS, Math.max(0, Math.round(position)));
}

export function positionToBudget(position: number): number {
  return position <= MID_POSITION
    ? BUDGET_MIN + position * LOW_STEP
    : BUDGET_MID + (position - MID_POSITION) * HIGH_STEP;
}

export interface PlanSummary {
  used_eur: number;
  people: number;
  avg_cost_eur: number;
  zones: number;
  /** True when a zone holds more than one intervention, so one person can be counted twice. */
  overlapping_zones: boolean;
}

export function summarisePlan(plan: PlanItem[]): PlanSummary {
  const used_eur = plan.reduce((sum, item) => sum + item.budget_eur, 0);
  const people = plan.reduce((sum, item) => sum + item.people_reached, 0);
  const zones = new Set(plan.map((item) => item.zone_id)).size;
  return {
    used_eur,
    people,
    // Spend divided by people, not the mean of the rows: a small item must not count like a large one.
    avg_cost_eur: people > 0 ? used_eur / people : NaN,
    zones,
    overlapping_zones: zones < plan.length,
  };
}

/**
 * One line naming what weighed most on this pair: zone score x the user's weight x how
 * well the intervention addresses that need, the same product the planner sums. The
 * highest raw score alone can name a need the intervention barely touches. The wording
 * follows the score itself, so a score of 35 is never described as "forte".
 */
export function reasonFor(
  scores: PlanItem['scores'], weights: Weights, fit: Weights | undefined, lang: Lang,
): string | null {
  const noWeights = allWeightsZero(weights);
  const weightOf = (key: Criterion) =>
    (noWeights ? 1 : weights[key]) * (fit ? fit[key] : 1) * scores[key];
  const candidates = CRITERIA.filter((key) => Number.isFinite(weightOf(key)));
  if (candidates.length === 0) return null;

  const strongest = candidates.reduce((best, key) => (weightOf(key) > weightOf(best) ? key : best));
  const score = Math.round(scores[strongest]);
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return `${copyFor(lang).planner.reasons[strongest][level]} (${score}/100)`;
}

export const hasActiveFilters = (filters: Filters) =>
  filters.circ.length > 0 || filters.exclude_funded || filters.min_over75 > 0;

export function filtersRecap(filters: Filters, lang: Lang): string {
  const t = copyFor(lang).planner;
  const circ = [...filters.circ].sort((a, b) => a - b);
  const parts = [
    circ.length === 0 ? t.recapAllCirc
      : circ.length === 1 ? t.recapOneCirc(circ[0])
        : t.recapManyCirc(circ.join(', ')),
  ];
  if (filters.exclude_funded) parts.push(t.recapNoFunded);
  if (filters.min_over75 > 0) parts.push(t.recapMinOver75(formatInt(filters.min_over75)));
  return parts.join(' · ');
}
