import type { Filters, Intervention, PlanItem, Weights, ZoneProps } from '../types';

const SCORE_KEYS = ['isolation', 'service_gap', 'future_pressure', 'inclusion'] as const;
const FULL_FIT: Weights = { isolation: 1, service_gap: 1, future_pressure: 1, inclusion: 1 };
const FUNDED_PENALTY = 0.8;
const ZONE_CAP_PERCENT = 35;
const INTERVENTION_CAP_PERCENT = 40;
const MIN_SCALED_PEOPLE = 10;

interface Candidate {
  zone: ZoneProps;
  intervention: Intervention;
  people: number;
  cost: number;
  /** depth * pair_need * additionality: what reaching one person is worth. */
  value_per_person: number;
  return_index: number;
}

interface Allocation {
  budget_eur: number;
  people_reached: number;
  return_index: number;
}

/** Every quantity here is non-negative; null, NaN and Infinity from data or user edits count as 0. */
const amount = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Weighted mean of the four scores on a 0-100 scale, each score first multiplied by its fit. */
function weightedScore(zone: ZoneProps, weights: Weights, fit: Weights): number {
  const raw = SCORE_KEYS.map((key) => amount(weights[key]));
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  // All-zero weights express no preference, so every score counts the same.
  const shares = raw.map((weight) => (total > 0 ? weight / total : 1 / SCORE_KEYS.length));
  return Math.min(100, SCORE_KEYS.reduce((sum, key, i) => sum + amount(zone[key]) * amount(fit[key]) * shares[i], 0));
}

/** Need of a zone on a 0-100 scale: the weighted mean of its four scores. */
export function zoneNeed(zone: ZoneProps, weights: Weights): number {
  return weightedScore(zone, weights, FULL_FIT);
}

function isEligible(zone: ZoneProps, filters: Filters): boolean {
  const circ = filters.circ ?? [];
  if (zone.small_zone) return false;
  if (circ.length > 0 && !circ.includes(zone.circ)) return false;
  if (amount(zone.over75_est) < amount(filters.min_over75)) return false;
  return !(filters.exclude_funded && amount(zone.funded_share) > 0);
}

function scorePair(zone: ZoneProps, intervention: Intervention, weights: Weights): Candidate {
  const people = amount(zone[intervention.target]) * amount(intervention.reach_share);
  const cost = amount(intervention.fixed_eur) + people * amount(intervention.eur_per_person);
  const pairNeed = weightedScore(zone, weights, intervention.fit) / 100;
  const additionality = 1 - FUNDED_PENALTY * Math.min(1, amount(zone.funded_share));
  const value_per_person = amount(intervention.depth) * pairNeed * additionality;
  return { zone, intervention, people, cost, value_per_person, return_index: (people * value_per_person) / cost };
}

/** A pair must reach someone, cost something and return something. This also rules out NaN and Infinity. */
const isFundable = ({ people, cost, return_index }: Candidate): boolean =>
  Math.round(people) >= 1 && Math.round(cost) >= 1 && return_index > 0;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareCandidates = (a: Candidate, b: Candidate): number =>
  b.return_index - a.return_index ||
  a.zone.id - b.zone.id ||
  compareIds(a.intervention.id, b.intervention.id);

/** Funds a pair whole if it fits in `available` euro, otherwise scaled down, otherwise not at all. */
function allocate(candidate: Candidate, available: number): Allocation | null {
  const { intervention, people, cost, value_per_person, return_index } = candidate;
  const wholeCost = Math.round(cost);
  if (wholeCost <= available) return { budget_eur: wholeCost, people_reached: Math.round(people), return_index };

  const fixed = amount(intervention.fixed_eur);
  const perPerson = amount(intervention.eur_per_person);
  if (perPerson === 0) return null;
  // Only the variable part shrinks. Rounding people down keeps the budget within `available`.
  const scaledPeople = Math.floor((available - fixed) / perPerson);
  if (scaledPeople < MIN_SCALED_PEOPLE) return null;
  const scaledCost = fixed + scaledPeople * perPerson;
  return {
    budget_eur: Math.round(scaledCost),
    people_reached: scaledPeople,
    return_index: (scaledPeople * value_per_person) / scaledCost,
  };
}

function toPlanItem(
  { zone, intervention }: Candidate,
  { budget_eur, people_reached, return_index }: Allocation,
): PlanItem {
  return {
    zone_id: zone.id,
    zone_name: zone.name,
    circ: zone.circ,
    intervention_id: intervention.id,
    intervention_label: intervention.label,
    budget_eur,
    people_reached,
    cost_per_person_eur: Math.round(budget_eur / people_reached),
    return_index,
    scores: {
      isolation: amount(zone.isolation),
      service_gap: amount(zone.service_gap),
      future_pressure: amount(zone.future_pressure),
      inclusion: amount(zone.inclusion),
      funded_share: amount(zone.funded_share),
    },
    confidence: zone.confidence,
  };
}

const percentOf = (total: number, percent: number): number => Math.floor((total * percent) / 100);

/**
 * Greedy allocation by return_index, where
 *   pair_need    = weighted mean of the zone scores, each multiplied by the intervention's fit, 0 to 1
 *   return_index = people * depth * pair_need * additionality / cost.
 * The plan keeps that ranking order, taken from the whole pairs. A scaled-down item reports the
 * return_index of its reduced people and cost, so it can show less than an item ranked below it.
 */
export function computePlan(
  zones: ZoneProps[], interventions: Intervention[], weights: Weights, filters: Filters, budget: number,
): PlanItem[] {
  // Allocations are whole euro, so whole-euro limits make every comparison below exact.
  const totalBudget = Math.floor(amount(budget));
  const zoneCap = percentOf(totalBudget, ZONE_CAP_PERCENT);
  const interventionCap = percentOf(totalBudget, INTERVENTION_CAP_PERCENT);

  const candidates = zones
    .filter((zone) => isEligible(zone, filters))
    .flatMap((zone) => interventions.map((intervention) => scorePair(zone, intervention, weights)))
    .filter(isFundable)
    .sort(compareCandidates);

  const plan: PlanItem[] = [];
  const seenPairs = new Set<string>();
  const spentByZone = new Map<number, number>();
  const spentByIntervention = new Map<string, number>();
  let remaining = totalBudget;

  for (const candidate of candidates) {
    const { zone, intervention } = candidate;
    const pair = `${zone.id}|${intervention.id}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);

    const zoneSpent = spentByZone.get(zone.id) ?? 0;
    const interventionSpent = spentByIntervention.get(intervention.id) ?? 0;
    const available = Math.min(remaining, zoneCap - zoneSpent, interventionCap - interventionSpent);
    const allocation = allocate(candidate, available);
    if (!allocation) continue;

    remaining -= allocation.budget_eur;
    spentByZone.set(zone.id, zoneSpent + allocation.budget_eur);
    spentByIntervention.set(intervention.id, interventionSpent + allocation.budget_eur);
    plan.push(toPlanItem(candidate, allocation));
  }
  return plan;
}
