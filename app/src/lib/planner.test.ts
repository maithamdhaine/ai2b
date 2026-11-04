import { describe, expect, it } from 'vitest';
import datasetGeojson from '../../public/data/zones.geojson?raw';
import { interventions } from '../data/interventions';
import type { Filters, Intervention, PlanItem, Weights, ZoneCollection, ZoneProps } from '../types';
import { computePlan, zoneNeed } from './planner';

const WEIGHTS: Weights = { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 };
const ZERO_WEIGHTS: Weights = { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 };
const FULL_FIT: Weights = { isolation: 1, service_gap: 1, future_pressure: 1, inclusion: 1 };
const NO_FILTERS: Filters = { circ: [], exclude_funded: false, min_over75: 0 };

function makeZone(id: number, overrides: Partial<ZoneProps> = {}): ZoneProps {
  return {
    id, name: `Zona ${id}`, circ: 1, pop_2025: 10000,
    over65_est: 1000, over75_est: 400, adults_50_64_est: 2000, over75_2030: null,
    alone_rate_circ: 0.3, foreign_share: 0.1,
    isolation: 80, service_gap: 60, future_pressure: 40, inclusion: 20,
    funded_eur: 0, funded_projects: 0, funded_share: 0,
    nearest: { health_m: null, care_m: null, pharmacy_m: null },
    services_800m: 0, stability_top10: null, confidence: 'estimated', small_zone: false,
    ...overrides,
  };
}

// 500 people at 100 euro on top of 1000 fixed: 51000 euro for a default zone.
// Depth 1 and full fit make pair_need equal to the zone's need, 0.60 for a default zone.
function makeIntervention(id: string, overrides: Partial<Intervention> = {}): Intervention {
  return {
    id, label: id, target: 'over65_est', reach_share: 0.5, fixed_eur: 1000, eur_per_person: 100,
    depth: 1, fit: FULL_FIT, ...overrides,
  };
}

/** 94 varied zones, shaped like the Turin dataset and reproducible from run to run. */
function manyZones(): ZoneProps[] {
  let seed = 42;
  const random = (max: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return Math.floor((seed / 4294967296) * max);
  };
  return Array.from({ length: 94 }, (_, i) => makeZone(i + 1, {
    circ: (i % 8) + 1,
    over65_est: 60 + random(6300),
    over75_est: 30 + random(3400),
    adults_50_64_est: 50 + random(5000),
    isolation: random(101),
    service_gap: random(101),
    future_pressure: random(101),
    inclusion: random(101),
    funded_share: i % 3 === 0 ? random(100) / 100 : 0,
    small_zone: i % 30 === 7,
  }));
}

const BUDGETS = [1, 999, 3400, 10000, 33333, 99999.99, 100000, 200000, 250000, 1000000, 50000000];

const totalSpent = (plan: PlanItem[]) => plan.reduce((sum, item) => sum + item.budget_eur, 0);

function spentBy<K>(plan: PlanItem[], key: (item: PlanItem) => K): Map<K, number> {
  const spent = new Map<K, number>();
  for (const item of plan) spent.set(key(item), (spent.get(key(item)) ?? 0) + item.budget_eur);
  return spent;
}

const spentByZone = (plan: PlanItem[]) => spentBy(plan, (item) => item.zone_id);
const spentByType = (plan: PlanItem[]) => spentBy(plan, (item) => item.intervention_id);
const fundedZoneIds = (plan: PlanItem[]) => [...spentByZone(plan).keys()].sort((a, b) => a - b);
const pairOf = (item: PlanItem) => `${item.zone_id}|${item.intervention_id}`;

describe('interventions', () => {
  it('holds the five agreed interventions', () => {
    expect(interventions.map((i) => [i.id, i.label, i.target, i.reach_share, i.fixed_eur, i.eur_per_person])).toEqual([
      ['visite_domiciliari', 'Visite e compagnia a domicilio', 'over75_est', 0.1, 10000, 350],
      ['hub_prossimita', 'Hub di prossimità e cura', 'over65_est', 0.15, 60000, 80],
      ['accesso_salute', 'Accesso digitale e sanitario', 'over65_est', 0.1, 5000, 120],
      ['sicurezza_digitale', 'Sicurezza digitale e anti-truffa', 'over65_est', 0.2, 3000, 40],
      ['inserimento_lavoro', 'Inserimento lavorativo over 50 e nuovi residenti', 'adults_50_64_est', 0.03, 15000, 900],
    ]);
  });

  it('keeps every fit between 0 and 1 and every depth positive', () => {
    for (const { fit, depth } of interventions) {
      for (const value of Object.values(fit)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(depth).toBeGreaterThan(0);
    }
  });
});

describe('zoneNeed', () => {
  it('is the weighted mean of the four scores on a 0-100 scale', () => {
    // 80*0.4 + 60*0.3 + 40*0.2 + 20*0.1 = 32 + 18 + 8 + 2 = 60
    expect(zoneNeed(makeZone(1), WEIGHTS)).toBeCloseTo(60, 10);
  });

  it('normalises by the sum of the weights', () => {
    // (80*2 + 60*2) / 4 = 70
    expect(zoneNeed(makeZone(1), { isolation: 2, service_gap: 2, future_pressure: 0, inclusion: 0 })).toBeCloseTo(70, 10);
  });

  it('treats all-zero weights as equal weights', () => {
    // (80 + 60 + 40 + 20) / 4 = 50
    expect(zoneNeed(makeZone(1), ZERO_WEIGHTS)).toBeCloseTo(50, 10);
  });

  it('stays between 0 and 100 at the extremes of the score range', () => {
    const lowest = makeZone(1, { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 });
    const highest = makeZone(2, { isolation: 100, service_gap: 100, future_pressure: 100, inclusion: 100 });
    expect(zoneNeed(lowest, WEIGHTS)).toBe(0);
    expect(zoneNeed(highest, WEIGHTS)).toBeCloseTo(100, 10);
    expect(zoneNeed(highest, WEIGHTS)).toBeLessThanOrEqual(100);
  });

  it('stays between 0 and 100 when a score is out of range', () => {
    expect(zoneNeed(makeZone(1, { isolation: 900, service_gap: 900, future_pressure: 900, inclusion: 900 }), WEIGHTS)).toBe(100);
    expect(zoneNeed(makeZone(2, { isolation: -50, service_gap: 0, future_pressure: 0, inclusion: 0 }), WEIGHTS)).toBe(0);
  });
});

describe('computePlan: hand-computed example', () => {
  const ascolto = makeIntervention('ascolto', {
    reach_share: 0.2, fixed_eur: 3000, eur_per_person: 40, depth: 1,
    fit: { isolation: 1, service_gap: 0.5, future_pressure: 0.5, inclusion: 0 },
  });
  const cura = makeIntervention('cura', {
    reach_share: 0.1, fixed_eur: 5000, eur_per_person: 120, depth: 2,
    fit: { isolation: 0.5, service_gap: 1, future_pressure: 0, inclusion: 0.5 },
  });
  // Zone 1: scores 80/60/40/20, 1000 over 65, not funded, so additionality 1.
  const zone1 = makeZone(1, { name: 'Pilonetto', circ: 8, confidence: 'official' });
  // Zone 2: scores 100/50/50/0, 500 over 65, additionality 1 - 0.8*0.5 = 0.6.
  const zone2 = makeZone(2, {
    over65_est: 500, isolation: 100, service_gap: 50, future_pressure: 50, inclusion: 0, funded_share: 0.5,
  });

  // pair_need with weights 0.4/0.3/0.2/0.1 (they sum to 1):
  // 1 ascolto  (0.4*1*80   + 0.3*0.5*60 + 0.2*0.5*40 + 0.1*0*20)  / 100 = (32 +  9   + 4 + 0) / 100 = 0.45
  // 2 ascolto  (0.4*1*100  + 0.3*0.5*50 + 0.2*0.5*50 + 0.1*0*0)   / 100 = (40 +  7.5 + 5 + 0) / 100 = 0.525
  // 1 cura     (0.4*0.5*80 + 0.3*1*60   + 0.2*0*40   + 0.1*0.5*20)/ 100 = (16 + 18   + 0 + 1) / 100 = 0.35
  // 2 cura     (0.4*0.5*100+ 0.3*1*50   + 0.2*0*50   + 0.1*0.5*0) / 100 = (20 + 15   + 0 + 0) / 100 = 0.35
  //
  // Whole pairs, return_index = people * depth * pair_need * additionality / cost:
  // 1 ascolto  200 people  3000 + 200*40  = 11000   200*1*0.45*1    / 11000 = 0.0081818182
  // 2 ascolto  100 people  3000 + 100*40  =  7000   100*1*0.525*0.6 /  7000 = 0.0045
  // 1 cura     100 people  5000 + 100*120 = 17000   100*2*0.35*1    / 17000 = 0.0041176471
  // 2 cura      50 people  5000 +  50*120 = 11000    50*2*0.35*0.6  / 11000 = 0.0019090909
  //
  // Budget 40000: each zone is capped at 14000 and each intervention type at 16000.
  // 1 ascolto: 11000 fits whole. Zone 1 has 3000 left, ascolto has 5000 left.
  // 2 ascolto: the type cap leaves 5000, so (5000 - 3000) / 40 = 50 people for 5000.
  //            Shown index 50*1*0.525*0.6 / 5000 = 0.00315. Zone 2 has 9000 left.
  // 1 cura:    zone 1 has 3000 left, less than the 5000 fixed cost, so it is skipped.
  // 2 cura:    the zone cap leaves 9000, so (9000 - 5000) / 120 = 33.3, which is 33 people,
  //            costing 5000 + 33*120 = 8960, or 8960 / 33 = 271.52 per person.
  //            Shown index 33*2*0.35*0.6 / 8960 = 0.001546875.
  const plan = computePlan([zone1, zone2], [ascolto, cura], WEIGHTS, NO_FILTERS, 40000);

  it('allocates the expected pairs, budgets and people, in ranking order', () => {
    expect(plan.map((i) => [i.zone_id, i.intervention_id, i.budget_eur, i.people_reached, i.cost_per_person_eur])).toEqual([
      [1, 'ascolto', 11000, 200, 55],
      [2, 'ascolto', 5000, 50, 100],
      [2, 'cura', 8960, 33, 272],
    ]);
    expect(totalSpent(plan)).toBe(24960);
  });

  it('computes the expected return indices, reduced on the scaled items', () => {
    expect(plan[0].return_index).toBeCloseTo(0.0081818182, 9);
    expect(plan[1].return_index).toBeCloseTo(0.00315, 9);
    expect(plan[2].return_index).toBeCloseTo(0.001546875, 9);
  });

  it('fills in every field of a plan item', () => {
    expect(plan[0]).toEqual({
      zone_id: 1, zone_name: 'Pilonetto', circ: 8,
      intervention_id: 'ascolto', intervention_label: 'ascolto',
      budget_eur: 11000, people_reached: 200, cost_per_person_eur: 55,
      return_index: expect.closeTo(0.0081818182, 9),
      scores: { isolation: 80, service_gap: 60, future_pressure: 40, inclusion: 20, funded_share: 0 },
      confidence: 'official',
    });
  });

  it('ranks the five real interventions as computed by hand', () => {
    // Default zone, weights 0.4/0.3/0.2/0.1:
    // pair_need:  sicurezza (19.2 + 1.8 + 2.4 + 0.4) / 100 = 0.238
    //             visite    (32 + 5.4 + 4 + 0.2)     / 100 = 0.416
    //             accesso   (12.8 + 16.2 + 2.4 + 0.8)/ 100 = 0.322
    //             hub       (16 + 18 + 4 + 0.6)      / 100 = 0.386
    //             inser.    (3.2 + 1.8 + 0.8 + 2)    / 100 = 0.078
    // index:      sicurezza 200*1*0.238 / 11000 = 0.0043273
    //             visite     40*6*0.416 / 24000 = 0.0041600
    //             accesso   100*2*0.322 / 17000 = 0.0037882
    //             hub       150*3*0.386 / 72000 = 0.0024125
    //             inser.     60*5*0.078 / 69000 = 0.0003391
    // With a budget of 1000000 the caps are 350000 and 400000, so all of them fit whole.
    const all = computePlan([makeZone(1)], interventions, WEIGHTS, NO_FILTERS, 1000000);
    expect(all.map((i) => [i.intervention_id, i.budget_eur, i.people_reached])).toEqual([
      ['sicurezza_digitale', 11000, 200],
      ['visite_domiciliari', 24000, 40],
      ['accesso_salute', 17000, 100],
      ['hub_prossimita', 72000, 150],
      ['inserimento_lavoro', 69000, 60],
    ]);
    expect(all.map((i) => i.return_index)).toEqual([
      expect.closeTo(0.0043273, 6), expect.closeTo(0.00416, 6), expect.closeTo(0.0037882, 6),
      expect.closeTo(0.0024125, 6), expect.closeTo(0.0003391, 6),
    ]);
  });
});

describe('computePlan: fit and depth', () => {
  const indexOf = (intervention: Intervention, weights: Weights = WEIGHTS) =>
    computePlan([makeZone(1)], [intervention], weights, NO_FILTERS, 1000000)[0].return_index;
  const onlyIsolation: Weights = { isolation: 1, service_gap: 0, future_pressure: 0, inclusion: 0 };
  const onlyInclusion: Weights = { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 1 };

  it('multiplies each score by the fit of the intervention', () => {
    // pair_need (0.4*1*80 + 0.3*0.5*60) / 100 = (32 + 9) / 100 = 0.41, so 500 * 0.41 / 51000 = 0.0040196078
    const pair = makeIntervention('a', { fit: { isolation: 1, service_gap: 0.5, future_pressure: 0, inclusion: 0 } });
    expect(indexOf(pair)).toBeCloseTo(0.0040196078, 9);
  });

  it('normalises by the sum of the weights, not by the fit', () => {
    // (2*1*80 + 2*0.5*60) / 4 / 100 = (160 + 60) / 400 = 0.55, so 500 * 0.55 / 51000 = 0.0053921569
    const pair = makeIntervention('a', { fit: { isolation: 1, service_gap: 0.5, future_pressure: 0, inclusion: 0 } });
    expect(indexOf(pair, { isolation: 2, service_gap: 2, future_pressure: 0, inclusion: 0 })).toBeCloseTo(0.0053921569, 9);
  });

  it('treats all-zero weights as equal weights', () => {
    // (0.25*1*80 + 0.25*0.5*60) / 100 = (20 + 7.5) / 100 = 0.275, so 500 * 0.275 / 51000 = 0.0026960784
    const pair = makeIntervention('a', { fit: { isolation: 1, service_gap: 0.5, future_pressure: 0, inclusion: 0 } });
    expect(indexOf(pair, ZERO_WEIGHTS)).toBeCloseTo(0.0026960784, 9);
  });

  it('multiplies the return by depth', () => {
    expect(indexOf(makeIntervention('a', { depth: 3 })) / indexOf(makeIntervention('a'))).toBeCloseTo(3, 10);
  });

  it('lets the priorities decide which intervention of a zone ranks first', () => {
    const care = makeIntervention('care', { fit: { isolation: 1, service_gap: 0, future_pressure: 0, inclusion: 0.1 } });
    const work = makeIntervention('work', { fit: { isolation: 0.1, service_gap: 0, future_pressure: 0, inclusion: 1 } });
    const order = (weights: Weights) =>
      computePlan([makeZone(1)], [care, work], weights, NO_FILTERS, 1000000).map((i) => i.intervention_id);
    expect(order(onlyIsolation)).toEqual(['care', 'work']);
    expect(order(onlyInclusion)).toEqual(['work', 'care']);
  });

  it('skips a pair that fits none of the active priorities', () => {
    const pair = makeIntervention('a', { fit: { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 1 } });
    expect(computePlan([makeZone(1)], [pair], onlyIsolation, NO_FILTERS, 100000)).toEqual([]);
  });

  it('skips an intervention with no depth', () => {
    expect(computePlan([makeZone(1)], [makeIntervention('a', { depth: 0 })], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });

  it('counts an invalid fit or depth as zero', () => {
    // pair_need (0 + 18 + 8 + 2) / 100 = 0.28, so 500 * 0.28 / 51000 = 0.002745098
    const invalidFit = makeIntervention('a', { fit: { ...FULL_FIT, isolation: Number.NaN } });
    expect(indexOf(invalidFit)).toBeCloseTo(0.002745098, 9);
    const invalidDepth = makeIntervention('a', { depth: Number.NaN });
    expect(computePlan([makeZone(1)], [invalidDepth], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });

  it('leaves zoneNeed out of it: the zone need does not depend on any intervention', () => {
    const pair = makeIntervention('a', { fit: { isolation: 0.1, service_gap: 0.1, future_pressure: 0.1, inclusion: 0.1 } });
    expect(indexOf(pair)).toBeCloseTo(indexOf(makeIntervention('a')) * 0.1, 10);
    expect(zoneNeed(makeZone(1), WEIGHTS)).toBeCloseTo(60, 10);
  });
});

describe('computePlan: budget and caps', () => {
  it('never exceeds the budget', () => {
    for (const budget of BUDGETS) {
      expect(totalSpent(computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, budget))).toBeLessThanOrEqual(budget);
    }
  });

  it('spends the budget down to the last euro when the money can be scaled exactly', () => {
    // Three equal types, so ties run zone by zone, then a, b, c. Budget 10000: zone cap 3500, type cap 4000.
    // Zone 1 gives a 3500. In zone 2, a has only 500 left, less than its fixed cost, so b takes 3500.
    // In zone 3, a and b have 500 left each, so c takes the 3000 still unspent: (3000 - 1000) / 100 = 20 people.
    const zones = [makeZone(1), makeZone(2), makeZone(3), makeZone(4)];
    const types = [makeIntervention('a'), makeIntervention('b'), makeIntervention('c')];
    const plan = computePlan(zones, types, WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.zone_id, i.intervention_id, i.budget_eur, i.people_reached])).toEqual([
      [1, 'a', 3500, 25],
      [2, 'b', 3500, 25],
      [3, 'c', 3000, 20],
    ]);
    expect(totalSpent(plan)).toBe(10000);
  });

  it('stays within a budget that is not a whole number of euro', () => {
    // Budget 1000.50: 1000 in whole euro, zone cap 350, type cap 400, and each person costs 0.50.
    // Against the exact 1000.50, the last row would have 200.50: 401 people, rounding up to 201, for a total of 1001.
    const type = (id: string) => makeIntervention(id, { reach_share: 1, fixed_eur: 0, eur_per_person: 0.5 });
    const plan = computePlan([makeZone(1), makeZone(2), makeZone(3)], [type('a'), type('b'), type('c')], WEIGHTS, NO_FILTERS, 1000.5);
    expect(plan.map((i) => [i.zone_id, i.intervention_id, i.budget_eur, i.people_reached])).toEqual([
      [1, 'a', 350, 700],
      [2, 'a', 50, 100],
      [2, 'b', 300, 600],
      [3, 'b', 100, 200],
      [3, 'c', 200, 400],
    ]);
    expect(totalSpent(plan)).toBe(1000);
  });

  it('caps every zone at 35% of the budget', () => {
    for (const budget of BUDGETS) {
      const plan = computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, budget);
      for (const spent of spentByZone(plan).values()) expect(spent).toBeLessThanOrEqual(budget * 0.35);
    }
  });

  it('caps every intervention type at 40% of the budget', () => {
    for (const budget of BUDGETS) {
      const plan = computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, budget);
      for (const spent of spentByType(plan).values()) expect(spent).toBeLessThanOrEqual(budget * 0.4);
    }
  });

  it('leaves money unspent rather than breaking the zone cap when only one zone is eligible', () => {
    // Budget 50000, zone cap 17500. The first type costs 11000, leaving 6500.
    // The second (whole cost 17000) scales to (6500 - 5000) / 120 = 12.5, so 12 people for 6440. Total 17440.
    const first = makeIntervention('first', { reach_share: 0.2, fixed_eur: 3000, eur_per_person: 40 });
    const second = makeIntervention('second', { reach_share: 0.1, fixed_eur: 5000, eur_per_person: 120 });
    const plan = computePlan([makeZone(1)], [first, second], WEIGHTS, NO_FILTERS, 50000);
    expect(plan.map((i) => [i.intervention_id, i.budget_eur, i.people_reached])).toEqual([
      ['first', 11000, 200],
      ['second', 6440, 12],
    ]);
    expect(totalSpent(plan)).toBe(17440);
  });

  it('leaves money unspent rather than breaking the type cap when only one type is available', () => {
    // Budget 40000, zone cap 14000, type cap 16000. Each person costs 100 on top of a fixed cost of 100.
    // Zone 1 takes (14000 - 100) / 100 = 139 people for 14000. Zone 2 gets the 2000 left: 19 people. Zone 3 gets nothing.
    const plan = computePlan([makeZone(1), makeZone(2), makeZone(3)], [makeIntervention('a', { fixed_eur: 100 })], WEIGHTS, NO_FILTERS, 40000);
    expect(plan.map((i) => [i.zone_id, i.budget_eur, i.people_reached])).toEqual([[1, 14000, 139], [2, 2000, 19]]);
    expect(totalSpent(plan)).toBe(16000);
  });

  it('moves on to the next type once a type reaches its cap', () => {
    // Budget 10000, type cap 4000. Index 'a' 10*0.6/2000 = 0.003, 'b' 10*0.6/2100 = 0.00286.
    // 'a' funds zones 1 and 2 and reaches 4000, so zone 3 falls to 'b'. Zones 1 and 2 have 1500 left, too little for 'b'.
    const a = makeIntervention('a', { reach_share: 0.01 });
    const b = makeIntervention('b', { reach_share: 0.01, eur_per_person: 110 });
    const plan = computePlan([makeZone(1), makeZone(2), makeZone(3)], [a, b], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.zone_id, i.intervention_id, i.budget_eur])).toEqual([[1, 'a', 2000], [2, 'a', 2000], [3, 'b', 2100]]);
  });

  it('allows a zone to reach exactly its cap', () => {
    // Cost 3500 is exactly 35% of 10000.
    const plan = computePlan([makeZone(1)], [makeIntervention('a', { reach_share: 0.025 })], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[3500, 25]]);
  });

  it('allows a type to reach exactly its cap', () => {
    // Two rows of 2000 are exactly 40% of 10000.
    const plan = computePlan([makeZone(1), makeZone(2), makeZone(3)], [makeIntervention('a', { reach_share: 0.01 })], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.zone_id, i.budget_eur])).toEqual([[1, 2000], [2, 2000]]);
  });

  it('returns an empty plan for a zero, negative or invalid budget', () => {
    for (const budget of [0, -1000, Number.NaN, 0.5]) {
      expect(computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, budget)).toEqual([]);
    }
  });
});

describe('computePlan: scaling down', () => {
  it('reduces people and the variable cost, keeping the fixed cost whole', () => {
    // Whole cost 51000, zone cap 3500: (3500 - 1000) / 100 = 25 people, costing 1000 + 25*100 = 3500.
    const plan = computePlan([makeZone(1)], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.budget_eur, i.people_reached, i.cost_per_person_eur])).toEqual([[3500, 25, 140]]);
  });

  it('rounds scaled people down so the money always covers them', () => {
    // Zone cap 3550 * 0.35 = 1242.5, so 1242 in whole euro: (1242 - 1000) / 20 = 12.1, so 12 people for 1240.
    const cheap = makeIntervention('a', { eur_per_person: 20 });
    const plan = computePlan([makeZone(1)], [cheap], WEIGHTS, NO_FILTERS, 3550);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[1240, 12]]);
  });

  it('stays within a zone cap that is not a whole number of euro', () => {
    // Against the exact cap of 1242.5, 485 people would cost 1242.5 and round up to 1243, over the cap.
    // Against 1242 in whole euro: (1242 - 1000) / 0.5 = 484 people for 1242.
    const cheap = makeIntervention('a', { eur_per_person: 0.5 });
    const plan = computePlan([makeZone(1)], [cheap], WEIGHTS, NO_FILTERS, 3550);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[1242, 484]]);
  });

  it('stays within a type cap that is not a whole number of euro', () => {
    // Budget 3554: zone cap 1243.9, so 1243, and type cap 1421.6, so 1421. Zone 2 gets the 178 left: 356 people.
    // Against the exact 178.6, 357 people would cost 178.5 and round up to 179, over the cap.
    const cheap = makeIntervention('a', { reach_share: 1, fixed_eur: 0, eur_per_person: 0.5 });
    const zones = [makeZone(1, { over65_est: 3000 }), makeZone(2, { over65_est: 3000 })];
    const plan = computePlan(zones, [cheap], WEIGHTS, NO_FILTERS, 3554);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[1243, 2486], [178, 356]]);
  });

  it('accepts a scale-down to exactly 10 people', () => {
    // Budget 5715, zone cap floor(2000.25) = 2000: (2000 - 1000) / 100 = 10 people.
    const plan = computePlan([makeZone(1)], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 5715);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[2000, 10]]);
  });

  it('skips a pair that would drop below 10 people', () => {
    // Budget 5700, zone cap 1995: (1995 - 1000) / 100 = 9.95, so 9 people.
    expect(computePlan([makeZone(1)], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 5700)).toEqual([]);
  });

  it('applies the 10-person floor only to scaled pairs, not to small pairs that fit whole', () => {
    const plan = computePlan([makeZone(1)], [makeIntervention('a', { reach_share: 0.005 })], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.budget_eur, i.people_reached])).toEqual([[1500, 5]]);
  });

  it('skips a pair it cannot afford and moves on to the next one', () => {
    // Index per unit of need: costly 1000/21000 = 0.0476, cheap 10/1100 = 0.0091.
    // Costly ranks first, but its 20000 fixed cost exceeds the 3500 cap.
    const costly = makeIntervention('costly', { reach_share: 1, fixed_eur: 20000, eur_per_person: 1 });
    const cheap = makeIntervention('cheap', { reach_share: 0.01, fixed_eur: 1000, eur_per_person: 10 });
    const plan = computePlan([makeZone(1)], [costly, cheap], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.intervention_id, i.budget_eur])).toEqual([['cheap', 1100]]);
  });

  it('reports the return_index of the reduced people and cost on a scaled item', () => {
    // Whole pair 500 * 0.6 / 51000 = 0.0058823529, but 25 people for 3500 give 25 * 0.6 / 3500 = 0.0042857143.
    const [plain] = computePlan([makeZone(1)], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 10000);
    expect(plain.return_index).toBeCloseTo(0.0042857143, 9);

    // With depth 2 and only the isolation fit: pair_need 0.32, so 25 * 2 * 0.32 / 3500 = 0.0045714286.
    const isolationOnly = { isolation: 1, service_gap: 0, future_pressure: 0, inclusion: 0 };
    const [deep] = computePlan([makeZone(1)], [makeIntervention('a', { depth: 2, fit: isolationOnly })], WEIGHTS, NO_FILTERS, 10000);
    expect(deep.return_index).toBeCloseTo(0.0045714286, 9);
  });

  it('computes the reduced return_index from the unrounded cost', () => {
    // 20 people at 40.25 on top of 1000 fixed: 1805 euro, 1805 / 1805 = exact, so scale with an odd cap instead.
    // Budget 5000, zone cap 1750: (1750 - 1000) / 40.25 = 18.6, so 18 people costing 1724.5, shown as 1725.
    // 18 * 0.6 / 1724.5 = 0.0062626848
    const [item] = computePlan([makeZone(1)], [makeIntervention('a', { eur_per_person: 40.25 })], WEIGHTS, NO_FILTERS, 5000);
    expect([item.budget_eur, item.people_reached]).toEqual([1725, 18]);
    expect(item.return_index).toBeCloseTo(0.0062626848, 9);
  });

  it('keeps the ranking order even when a scaled item shows less than the item below it', () => {
    // Budget 10000, zone cap 3500, type cap 4000.
    // Whole pairs: x 500 * 0.6 / 51000 = 0.00588, y 25 * 0.6 / 3000 = 0.005, so x ranks first.
    // Zone 1 scales x down to 25 people for 3500, showing 0.00429. Zone 2 cannot fund x, as the type cap
    // leaves only 500, so it funds y whole, showing 0.005.
    const x = makeIntervention('x');
    const y = makeIntervention('y', { reach_share: 0.025, fixed_eur: 500 });
    const plan = computePlan([makeZone(1), makeZone(2)], [x, y], WEIGHTS, NO_FILTERS, 10000);
    expect(plan.map((i) => [i.zone_id, i.intervention_id])).toEqual([[1, 'x'], [2, 'y']]);
    expect(plan[0].return_index).toBeCloseTo(0.0042857143, 9);
    expect(plan[1].return_index).toBeCloseTo(0.005, 9);
  });

  it('always shows a reduced index below the whole-pair index', () => {
    const zones = manyZones();
    const whole = new Map(computePlan(zones, interventions, WEIGHTS, NO_FILTERS, 1e9).map((i) => [pairOf(i), i]));
    let scaled = 0;
    for (const budget of BUDGETS) {
      for (const item of computePlan(zones, interventions, WEIGHTS, NO_FILTERS, budget)) {
        const pair = whole.get(pairOf(item))!;
        if (item.budget_eur === pair.budget_eur) expect(item.return_index).toBe(pair.return_index);
        else {
          scaled++;
          expect(item.return_index).toBeLessThan(pair.return_index);
        }
      }
    }
    expect(scaled).toBeGreaterThan(0);
  });
});

describe('computePlan: zone selection', () => {
  it('excludes small zones however high their need', () => {
    const small = makeZone(1, { small_zone: true, isolation: 100, service_gap: 100, future_pressure: 100, inclusion: 100 });
    const plan = computePlan([small, makeZone(2)], interventions, WEIGHTS, NO_FILTERS, 1000000);
    expect(fundedZoneIds(plan)).toEqual([2]);
  });

  it('keeps only the chosen circoscrizioni, and all of them when the filter is empty', () => {
    const zones = [makeZone(1, { circ: 1 }), makeZone(2, { circ: 2 }), makeZone(3, { circ: 3 })];
    const plan = (circ: number[]) => computePlan(zones, interventions, WEIGHTS, { ...NO_FILTERS, circ }, 1000000);
    expect(fundedZoneIds(plan([2, 3]))).toEqual([2, 3]);
    expect(fundedZoneIds(plan([]))).toEqual([1, 2, 3]);
    expect(plan([9])).toEqual([]);
  });

  it('keeps zones with at least min_over75 residents over 75', () => {
    const zones = [makeZone(1, { over75_est: 299 }), makeZone(2, { over75_est: 300 }), makeZone(3, { over75_est: 301 })];
    const plan = computePlan(zones, interventions, WEIGHTS, { ...NO_FILTERS, min_over75: 300 }, 1000000);
    expect(fundedZoneIds(plan)).toEqual([2, 3]);
  });

  it('excludes any zone with funded_share above 0 when exclude_funded is on', () => {
    const zones = [makeZone(1, { funded_share: 0.01 }), makeZone(2, { funded_share: 0 }), makeZone(3, { funded_share: 0.9 })];
    const plan = (exclude_funded: boolean) => computePlan(zones, interventions, WEIGHTS, { ...NO_FILTERS, exclude_funded }, 1000000);
    expect(fundedZoneIds(plan(true))).toEqual([2]);
    expect(fundedZoneIds(plan(false))).toEqual([1, 2, 3]);
  });

  it('combines the filters', () => {
    const zones = [
      makeZone(1, { circ: 1, over75_est: 500 }),
      makeZone(2, { circ: 2, over75_est: 500 }),
      makeZone(3, { circ: 1, over75_est: 100 }),
      makeZone(4, { circ: 1, over75_est: 500, funded_share: 0.2 }),
    ];
    const filters: Filters = { circ: [1], exclude_funded: true, min_over75: 200 };
    expect(fundedZoneIds(computePlan(zones, interventions, WEIGHTS, filters, 1000000))).toEqual([1]);
  });
});

describe('computePlan: ranking', () => {
  it('orders every plan by the whole-pair ranking', () => {
    const zones = manyZones();
    // An effectively unlimited budget funds every pair whole, which shows the full ranking.
    const ranking = computePlan(zones, interventions, WEIGHTS, NO_FILTERS, 1e9);
    const indices = ranking.map((i) => i.return_index);
    expect(indices).toEqual([...indices].sort((a, b) => b - a));

    const position = new Map(ranking.map((item, index) => [pairOf(item), index]));
    for (const budget of BUDGETS) {
      const positions = computePlan(zones, interventions, WEIGHTS, NO_FILTERS, budget).map((i) => position.get(pairOf(i))!);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('uses each zone and intervention pair at most once, even if the input repeats a zone', () => {
    const zones = manyZones();
    const plan = computePlan([...zones, ...zones], interventions, WEIGHTS, NO_FILTERS, 50000000);
    const pairs = plan.map(pairOf);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('treats all-zero weights as equal weights', () => {
    const equal: Weights = { isolation: 0.25, service_gap: 0.25, future_pressure: 0.25, inclusion: 0.25 };
    const plan = computePlan(manyZones(), interventions, ZERO_WEIGHTS, NO_FILTERS, 100000);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan).toEqual(computePlan(manyZones(), interventions, equal, NO_FILTERS, 100000));

    // Default zone: need (80 + 60 + 40 + 20) / 4 / 100 = 0.5, so 500 * 0.5 / 51000 = 0.0049019608
    const [item] = computePlan([makeZone(1)], [makeIntervention('a')], ZERO_WEIGHTS, NO_FILTERS, 200000);
    expect(item.return_index).toBeCloseTo(0.0049019608, 9);
  });

  it('ranks a funded zone below an otherwise identical unfunded one', () => {
    // The funded zone has the lower id, so a tie-break could not explain the result.
    const zones = [makeZone(1, { funded_share: 0.5 }), makeZone(2)];
    const plan = computePlan(zones, [makeIntervention('a')], WEIGHTS, NO_FILTERS, 1000000);
    expect(plan.map((i) => i.zone_id)).toEqual([2, 1]);
    // Additionality is 1 - 0.8*0.5 = 0.6 against 1.
    expect(plan[1].return_index / plan[0].return_index).toBeCloseTo(0.6, 10);
  });

  it('applies the lowest additionality, 0.2, to a fully funded zone', () => {
    for (const funded_share of [1, 1.5]) {
      const zones = [makeZone(1, { funded_share }), makeZone(2)];
      const plan = computePlan(zones, [makeIntervention('a')], WEIGHTS, NO_FILTERS, 1000000);
      expect(plan[1].return_index / plan[0].return_index).toBeCloseTo(0.2, 10);
    }
  });

  it('breaks ties by zone id, then intervention id, whatever the input order', () => {
    const zones = [makeZone(2), makeZone(1)];
    const pairs = [makeIntervention('b'), makeIntervention('a')];
    const expected = [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']];
    const order = (z: ZoneProps[], i: Intervention[]) =>
      computePlan(z, i, WEIGHTS, NO_FILTERS, 1000000).map((item) => [item.zone_id, item.intervention_id]);
    expect(order(zones, pairs)).toEqual(expected);
    expect(order([...zones].reverse(), [...pairs].reverse())).toEqual(expected);
  });

  it('gives the same plan for the same input', () => {
    const run = () => computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, 250000);
    expect(run()).toEqual(run());
  });

  it('does not change its inputs', () => {
    const zones = manyZones();
    const list = [...interventions];
    computePlan(zones, list, WEIGHTS, NO_FILTERS, 100000);
    expect(zones).toEqual(manyZones());
    expect(list).toEqual(interventions);
  });
});

describe('computePlan: rounding and guards', () => {
  it('rounds people and euro to integers, after costing the unrounded people', () => {
    // 425 * 0.10 = 42.5 people, rounded to 43. Cost 10000 + 42.5*350 = 24875. 24875 / 43 = 578.49.
    const visite = makeIntervention('visite', { target: 'over75_est', reach_share: 0.1, fixed_eur: 10000, eur_per_person: 350 });
    const plan = computePlan([makeZone(1, { over75_est: 425 })], [visite], WEIGHTS, NO_FILTERS, 1000000);
    expect(plan.map((i) => [i.budget_eur, i.people_reached, i.cost_per_person_eur])).toEqual([[24875, 43, 578]]);
  });

  it('rounds a fractional cost to the nearest euro', () => {
    // 1001 * 0.5 = 500.5 people, rounded to 501. Cost 1000 + 500.5*30.2 = 16115.1. 16115 / 501 = 32.17.
    const pair = makeIntervention('a', { eur_per_person: 30.2 });
    const plan = computePlan([makeZone(1, { over65_est: 1001 })], [pair], WEIGHTS, NO_FILTERS, 1000000);
    expect(plan.map((i) => [i.budget_eur, i.people_reached, i.cost_per_person_eur])).toEqual([[16115, 501, 32]]);
  });

  it('produces only finite figures, with whole people and euro', () => {
    for (const budget of BUDGETS) {
      for (const item of computePlan(manyZones(), interventions, WEIGHTS, NO_FILTERS, budget)) {
        expect(Number.isInteger(item.budget_eur)).toBe(true);
        expect(Number.isInteger(item.people_reached)).toBe(true);
        expect(Number.isInteger(item.cost_per_person_eur)).toBe(true);
        expect(item.people_reached).toBeGreaterThan(0);
        expect(item.budget_eur).toBeGreaterThan(0);
        expect(Number.isFinite(item.return_index)).toBe(true);
        expect(Math.abs(item.cost_per_person_eur - item.budget_eur / item.people_reached)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('skips a zone with nobody in the target group', () => {
    expect(computePlan([makeZone(1, { over65_est: 0 })], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });

  it('skips a pair whose people round to zero', () => {
    const plan = computePlan([makeZone(1, { over65_est: 4 })], [makeIntervention('a', { reach_share: 0.1 })], WEIGHTS, NO_FILTERS, 100000);
    expect(plan).toEqual([]);
  });

  it('skips a pair with zero need, since it returns nothing', () => {
    const noNeed = makeZone(1, { isolation: 0, service_gap: 0, future_pressure: 0, inclusion: 0 });
    expect(computePlan([noNeed], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });

  it('skips a free intervention instead of producing an infinite index', () => {
    const free = makeIntervention('free', { fixed_eur: 0, eur_per_person: 0 });
    expect(computePlan([makeZone(1)], [free], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });

  it('skips a pair whose cost rounds to zero euro, on any budget', () => {
    // 500 people at 0.0001 euro cost 0.05 euro, which would show as a 0 euro item.
    const nearlyFree = makeIntervention('nearly_free', { fixed_eur: 0, eur_per_person: 0.0001 });
    expect(computePlan([makeZone(1)], [nearlyFree], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
    expect(computePlan([makeZone(1)], [nearlyFree], WEIGHTS, NO_FILTERS, 0)).toEqual([]);
  });

  it('handles an intervention with no per-person cost', () => {
    const flat = makeIntervention('flat', { fixed_eur: 5000, eur_per_person: 0 });
    const plan = (budget: number) => computePlan([makeZone(1)], [flat], WEIGHTS, NO_FILTERS, budget);
    expect(plan(100000).map((i) => [i.budget_eur, i.people_reached, i.cost_per_person_eur])).toEqual([[5000, 500, 10]]);
    expect(plan(10000)).toEqual([]);
  });

  it('counts missing or invalid zone figures as zero', () => {
    const missing = null as unknown as number;
    const noTarget = makeZone(1, { over65_est: missing });
    const noScore = makeZone(2, { isolation: Number.NaN, funded_share: missing });
    const plan = computePlan([noTarget, noScore], [makeIntervention('a')], WEIGHTS, NO_FILTERS, 1000000);
    expect(plan.map((i) => i.zone_id)).toEqual([2]);
    // Need (0 + 18 + 8 + 2) / 100 = 0.28, so 500 * 0.28 / 51000 = 0.0027450980
    expect(plan[0].return_index).toBeCloseTo(0.002745098, 9);
    expect(plan[0].scores).toEqual({ isolation: 0, service_gap: 60, future_pressure: 40, inclusion: 20, funded_share: 0 });
  });

  it('treats invalid or negative weights as zero', () => {
    const invalid: Weights = { isolation: Number.NaN, service_gap: -1, future_pressure: 0, inclusion: 0 };
    expect(zoneNeed(makeZone(1), invalid)).toBeCloseTo(50, 10);
  });

  it('treats a missing circ filter as no filter', () => {
    const filters = { ...NO_FILTERS, circ: null as unknown as number[] };
    expect(fundedZoneIds(computePlan([makeZone(1)], interventions, WEIGHTS, filters, 1000000))).toEqual([1]);
  });

  it('returns an empty plan when there are no zones or no interventions', () => {
    expect(computePlan([], interventions, WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
    expect(computePlan(manyZones(), [], WEIGHTS, NO_FILTERS, 100000)).toEqual([]);
  });
});

// These read the dataset in public/data, so they also flag it if real data changes the picture.
describe('computePlan: acceptance on the dataset in public/data', () => {
  const zones = (JSON.parse(datasetGeojson) as ZoneCollection).features.map((f) => f.properties);
  const plan = (weights: Weights, budget: number) => computePlan(zones, interventions, weights, NO_FILTERS, budget);
  const leaderOf = (items: PlanItem[]) => [...spentByType(items).entries()].sort((a, b) => b[1] - a[1])[0][0];

  it.each([100000, 200000])('shows at least 3 intervention types at %i with the default weights', (budget) => {
    expect(spentByType(plan(WEIGHTS, budget)).size).toBeGreaterThanOrEqual(3);
  });
});
