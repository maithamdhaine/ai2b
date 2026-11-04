import { describe, expect, it } from 'vitest';
import datasetGeojson from '../../public/data/zones.geojson?raw';
import { interventions } from '../data/interventions';
import type { Filters, PlanItem, Weights, ZoneCollection } from '../types';
import { computePlan } from './planner';

// The plan the jury sees on the demo laptop, run against the data files in public/data/.
// These are the shapes the demo depends on, not properties of the formula.
const zones = (JSON.parse(datasetGeojson) as ZoneCollection).features.map((f) => f.properties);
const NO_FILTERS: Filters = { circ: [], exclude_funded: false, min_over75: 0 };
const DEFAULT: Weights = { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 };
const dominant = (key: keyof Weights): Weights => ({
  isolation: 0.1, service_gap: 0.1, future_pressure: 0.1, inclusion: 0.1, [key]: 0.7,
});

const plan = (weights: Weights, budget: number) =>
  computePlan(zones, interventions, weights, NO_FILTERS, budget);

const types = (items: PlanItem[]) => new Set(items.map((i) => i.intervention_id));

function shareByType(items: PlanItem[]): Map<string, number> {
  const share = new Map<string, number>();
  for (const i of items) share.set(i.intervention_id, (share.get(i.intervention_id) ?? 0) + i.budget_eur);
  return share;
}

const largestType = (items: PlanItem[]) =>
  [...shareByType(items).entries()].sort((a, b) => b[1] - a[1])[0][0];

describe('the plan on the shipped data', () => {
  it('mixes at least three intervention types at 100.000 € and at 200.000 € with the default priorities', () => {
    expect(types(plan(DEFAULT, 100000)).size).toBeGreaterThanOrEqual(3);
    expect(types(plan(DEFAULT, 200000)).size).toBeGreaterThanOrEqual(3);
  });

  it('puts home visits at the top of the list when isolation dominates', () => {
    const items = plan(dominant('isolation'), 200000);
    expect(items[0].intervention_id).toBe('visite_domiciliari');
    // Home visits reach one zone's 35% cap and the 40% type cap then leaves too little for a
    // second zone, so a cheaper type can end a few hundred euro above them. Top two is the
    // strongest claim the caps allow; see the note in README.md.
    const byShare = [...shareByType(items).entries()].sort((a, b) => b[1] - a[1]);
    expect(byShare.slice(0, 2).map(([id]) => id)).toContain('visite_domiciliari');
  });

  it('brings in work inclusion when inclusion dominates', () => {
    expect(types(plan(dominant('inclusion'), 200000))).toContain('inserimento_lavoro');
  });

  it('leads with a service intervention when the service gap dominates', () => {
    expect(['hub_prossimita', 'accesso_salute']).toContain(largestType(plan(dominant('service_gap'), 200000)));
  });
});
