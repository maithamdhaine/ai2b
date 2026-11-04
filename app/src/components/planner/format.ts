import type { Confidence, Filters, PlanItem, TargetField, Weights } from '../../types';

// it-IT leaves four-digit numbers ungrouped by default ("9500"), which would sit
// badly next to "12.000" in the same column, so grouping is forced everywhere.
const grouping = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
const intFormat = new Intl.NumberFormat('it-IT', { ...grouping, maximumFractionDigits: 0 });
const eurFormat = new Intl.NumberFormat('it-IT', {
  ...grouping, style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});
const indexFormat = new Intl.NumberFormat('it-IT', {
  ...grouping, minimumFractionDigits: 1, maximumFractionDigits: 1,
});

const MISSING = '—';

export const formatInt = (n: number) => (Number.isFinite(n) ? intFormat.format(n) : MISSING);
export const formatEur = (n: number) => (Number.isFinite(n) ? eurFormat.format(n) : MISSING);

/**
 * The raw return_index is a value per euro (about 0,001 to 0,02), unreadable on a projector.
 * It is shown per 1.000 euro, which keeps every comparison and gives the number a plain meaning.
 */
export const INDEX_SCALE = 1000;
export const formatReturnIndex = (rawIndex: number) =>
  (Number.isFinite(rawIndex) ? indexFormat.format(rawIndex * INDEX_SCALE) : MISSING);

export type Criterion = keyof Weights;

export const CRITERIA: { key: Criterion; label: string }[] = [
  { key: 'isolation', label: 'Isolamento' },
  { key: 'service_gap', label: 'Carenza servizi' },
  { key: 'future_pressure', label: 'Pressione futura' },
  { key: 'inclusion', label: 'Inclusione' },
];

export const allWeightsZero = (weights: Weights) => CRITERIA.every(({ key }) => !(weights[key] > 0));

/**
 * Each weight as a whole percentage of the total, always adding up to 100.
 * With every weight at zero the plan counts the four criteria equally (see
 * lib/planner.ts), so that is what is reported here too.
 */
export function weightShares(weights: Weights): Record<Criterion, number> {
  if (allWeightsZero(weights)) {
    return { isolation: 25, service_gap: 25, future_pressure: 25, inclusion: 25 };
  }
  const total = CRITERIA.reduce((sum, { key }) => sum + weights[key], 0);
  const exact = CRITERIA.map(({ key }) => (weights[key] / total) * 100);
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
  /** True when a row shows a higher index than the row above, which a scaled-down item can cause. */
  index_out_of_order: boolean;
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
    index_out_of_order: plan.some((item, i) => i > 0 && item.return_index > plan[i - 1].return_index),
  };
}

const REASONS: Record<Criterion, { high: string; medium: string; low: string }> = {
  isolation: { high: 'Forte isolamento', medium: 'Isolamento medio', low: 'Isolamento basso' },
  service_gap: {
    high: 'Forte carenza di servizi', medium: 'Carenza di servizi media', low: 'Carenza di servizi bassa',
  },
  future_pressure: {
    high: 'Forte pressione futura', medium: 'Pressione futura media', low: 'Pressione futura bassa',
  },
  inclusion: {
    high: 'Forte bisogno di inclusione',
    medium: 'Bisogno di inclusione medio',
    low: 'Bisogno di inclusione basso',
  },
};

/**
 * One line naming what weighed most on this pair: zone score x the user's weight x how
 * well the intervention addresses that need, the same product the planner sums. The
 * highest raw score alone can name a need the intervention barely touches. The wording
 * follows the score itself, so a score of 35 is never described as "forte".
 */
export function reasonFor(scores: PlanItem['scores'], weights: Weights, fit?: Weights): string | null {
  const noWeights = allWeightsZero(weights);
  const weightOf = (key: Criterion) =>
    (noWeights ? 1 : weights[key]) * (fit ? fit[key] : 1) * scores[key];
  const candidates = CRITERIA.map(({ key }) => key).filter((key) => Number.isFinite(weightOf(key)));
  if (candidates.length === 0) return null;

  const strongest = candidates.reduce((best, key) => (weightOf(key) > weightOf(best) ? key : best));
  const score = Math.round(scores[strongest]);
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return `${REASONS[strongest][level]} (${score}/100)`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  official: 'Dato ufficiale',
  estimated: 'Stima',
  low: 'Affidabilità bassa',
};

export const TARGET_LABEL: Record<TargetField, string> = {
  over75_est: 'over 75',
  over65_est: 'over 65',
  adults_50_64_est: 'adulti 50-64',
};

export const hasActiveFilters = (filters: Filters) =>
  filters.circ.length > 0 || filters.exclude_funded || filters.min_over75 > 0;

export function filtersRecap(filters: Filters): string {
  const circ = [...filters.circ].sort((a, b) => a - b);
  const parts = [
    circ.length === 0 ? 'Tutte le circoscrizioni'
      : circ.length === 1 ? `Circoscrizione ${circ[0]}`
        : `Circoscrizioni ${circ.join(', ')}`,
  ];
  if (filters.exclude_funded) parts.push('senza zone finanziate');
  if (filters.min_over75 > 0) parts.push(`almeno ${formatInt(filters.min_over75)} over 75`);
  return parts.join(' · ');
}
