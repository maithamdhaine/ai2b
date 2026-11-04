import { describe, expect, it } from 'vitest';
import type { PlanItem, Weights } from '../../types';
import {
  BUDGET_MAX, BUDGET_MID, BUDGET_MIN, BUDGET_POSITIONS,
  budgetToPosition, filtersRecap, formatEur, formatInt, formatReturnIndex,
  positionToBudget, reasonFor, summarisePlan, weightShares,
} from './format';

const NBSP = ' ';
const scores = { isolation: 10, service_gap: 10, future_pressure: 10, inclusion: 10, funded_share: 0 };
const evenWeights: Weights = { isolation: 0.25, service_gap: 0.25, future_pressure: 0.25, inclusion: 0.25 };

const item = (patch: Partial<PlanItem>): PlanItem => ({
  zone_id: 1, zone_name: 'Zona', circ: 1, intervention_id: 'a', intervention_label: 'A',
  budget_eur: 0, people_reached: 0, cost_per_person_eur: 0, return_index: 0, scores, confidence: 'estimated',
  ...patch,
});

describe('it-IT formatting', () => {
  it('groups four-digit numbers, which it-IT leaves bare by default', () => {
    expect(formatInt(9500)).toBe('9.500');
    expect(formatEur(9500)).toBe(`9.500${NBSP}€`);
    expect(formatEur(1000000)).toBe(`1.000.000${NBSP}€`);
  });

  it('shows a dash instead of NaN or Infinity', () => {
    expect(formatEur(NaN)).toBe('—');
    expect(formatInt(Infinity)).toBe('—');
    expect(formatReturnIndex(NaN)).toBe('—');
  });

  it('shows the return index per 1.000 euro with a decimal comma', () => {
    expect(formatReturnIndex(0.0042)).toBe('4,2');
    expect(formatReturnIndex(0.0126)).toBe('12,6');
  });
});

describe('weightShares', () => {
  it('reports the default weights as they are', () => {
    expect(weightShares({ isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 }))
      .toEqual({ isolation: 40, service_gap: 30, future_pressure: 20, inclusion: 10 });
  });

  it('always adds up to 100, even when each share rounds down', () => {
    const shares = weightShares({ isolation: 1, service_gap: 1, future_pressure: 1, inclusion: 0 });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares.inclusion).toBe(0);
  });

  it('reads as a share of the total when the weights do not add up to 1', () => {
    expect(weightShares({ isolation: 1, service_gap: 1, future_pressure: 0, inclusion: 0 }).isolation).toBe(50);
  });

  it('matches the planner when every weight is zero: equal shares', () => {
    expect(weightShares({ isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 }))
      .toEqual({ isolation: 25, service_gap: 25, future_pressure: 25, inclusion: 25 });
  });
});

describe('budget slider scale', () => {
  it('puts 100.000 at the exact centre and spans the requested range', () => {
    expect(budgetToPosition(BUDGET_MIN)).toBe(0);
    expect(budgetToPosition(BUDGET_MID)).toBe(BUDGET_POSITIONS / 2);
    expect(budgetToPosition(BUDGET_MAX)).toBe(BUDGET_POSITIONS);
  });

  it('gives every position its own round value, so arrow keys never stick', () => {
    const values = Array.from({ length: BUDGET_POSITIONS + 1 }, (_, position) => positionToBudget(position));
    expect(new Set(values).size).toBe(BUDGET_POSITIONS + 1);
    values.forEach((value, position) => expect(budgetToPosition(value)).toBe(position));
    expect(values).toContain(150_000);
    expect(values).toContain(200_000);
    expect(values).toContain(500_000);
  });

  it('holds the thumb at the ends for a budget outside the track', () => {
    expect(budgetToPosition(0)).toBe(0);
    expect(budgetToPosition(5_000_000)).toBe(BUDGET_POSITIONS);
  });
});

describe('summarisePlan', () => {
  it('weights the average cost by people, not by row', () => {
    const summary = summarisePlan([
      item({ zone_id: 1, budget_eur: 9000, people_reached: 90 }),
      item({ zone_id: 2, budget_eur: 1000, people_reached: 10 }),
    ]);
    expect(summary).toMatchObject({ used_eur: 10000, people: 100, avg_cost_eur: 100, zones: 2 });
  });

  it('counts a zone once and flags that its people may overlap', () => {
    const summary = summarisePlan([
      item({ zone_id: 1, intervention_id: 'a' }), item({ zone_id: 1, intervention_id: 'b' }),
    ]);
    expect(summary).toMatchObject({ zones: 1, overlapping_zones: true });
  });

  it('has no average for an empty plan', () => {
    expect(summarisePlan([])).toMatchObject({ used_eur: 0, people: 0, zones: 0, overlapping_zones: false });
    expect(summarisePlan([]).avg_cost_eur).toBeNaN();
  });
});

describe('reasonFor', () => {
  it('uses the strongest score', () => {
    expect(reasonFor({ ...scores, service_gap: 82 }, evenWeights)).toBe('Forte carenza di servizi (82/100)');
  });

  it('does not call a modest score strong', () => {
    expect(reasonFor({ ...scores, isolation: 55 }, evenWeights)).toBe('Isolamento medio (55/100)');
    expect(reasonFor({ ...scores, isolation: 35 }, evenWeights)).toBe('Isolamento basso (35/100)');
  });

  it('ignores a criterion the user set to zero', () => {
    const weights = { ...evenWeights, inclusion: 0 };
    expect(reasonFor({ ...scores, inclusion: 99, isolation: 72 }, weights)).toBe('Forte isolamento (72/100)');
  });

  it('names what the intervention addresses, not just the highest score', () => {
    // Home visits barely touch the service gap, so that is not why they rank here.
    const fit = { isolation: 1, service_gap: 0.3, future_pressure: 0.5, inclusion: 0.1 };
    const zone = { ...scores, service_gap: 90, isolation: 85 };
    expect(reasonFor(zone, evenWeights)).toBe('Forte carenza di servizi (90/100)');
    expect(reasonFor(zone, evenWeights, fit)).toBe('Forte isolamento (85/100)');
  });

  it('frames inclusion as a need, in line with the project rules', () => {
    expect(reasonFor({ ...scores, inclusion: 90 }, evenWeights)).toBe('Forte bisogno di inclusione (90/100)');
  });

  it('still gives a reason when every weight is zero', () => {
    const none = { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 };
    expect(reasonFor({ ...scores, future_pressure: 75 }, none)).toBe('Forte pressione futura (75/100)');
  });
});

describe('filtersRecap', () => {
  it('states the default plainly', () => {
    expect(filtersRecap({ circ: [], exclude_funded: false, min_over75: 0 })).toBe('Tutte le circoscrizioni');
  });

  it('lists what is active, with circoscrizioni in order', () => {
    expect(filtersRecap({ circ: [6, 2], exclude_funded: true, min_over75: 1500 }))
      .toBe('Circoscrizioni 2, 6 · senza zone finanziate · almeno 1.500 over 75');
  });
});
