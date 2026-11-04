import type { Intervention } from '../types';

// Costs (fixed_eur, eur_per_person), fit and depth are team assumptions, not measured or
// sourced figures. Label them as assumptions in the UI and keep the costs editable.
//
// depth is the relative benefit to one person reached over a year, on a scale of its own:
// a year of weekly home visits (10) against a single anti-fraud workshop (1). It is what keeps
// the cheapest intervention per euro from winning everywhere.
export const interventions: Intervention[] = [
  {
    id: 'visite_domiciliari', label: 'Visite e compagnia a domicilio', target: 'over75_est',
    reach_share: 0.1, fixed_eur: 10000, eur_per_person: 350, depth: 10,
    fit: { isolation: 1, service_gap: 0.3, future_pressure: 0.5, inclusion: 0.1 },
  },
  {
    id: 'hub_prossimita', label: 'Hub di prossimità e cura', target: 'over65_est',
    reach_share: 0.15, fixed_eur: 60000, eur_per_person: 80, depth: 3,
    fit: { isolation: 0.5, service_gap: 1, future_pressure: 0.5, inclusion: 0.3 },
  },
  {
    id: 'accesso_salute', label: 'Accesso digitale e sanitario', target: 'over65_est',
    reach_share: 0.1, fixed_eur: 5000, eur_per_person: 120, depth: 2,
    fit: { isolation: 0.4, service_gap: 0.9, future_pressure: 0.3, inclusion: 0.4 },
  },
  {
    id: 'sicurezza_digitale', label: 'Sicurezza digitale e anti-truffa', target: 'over65_est',
    reach_share: 0.2, fixed_eur: 3000, eur_per_person: 40, depth: 1,
    // A one-off workshop protects savings; it barely touches how alone someone is.
    fit: { isolation: 0.3, service_gap: 0.1, future_pressure: 0.3, inclusion: 0.2 },
  },
  {
    id: 'inserimento_lavoro', label: 'Inserimento lavorativo over 50 e nuovi residenti', target: 'adults_50_64_est',
    reach_share: 0.03, fixed_eur: 15000, eur_per_person: 900, depth: 12,
    fit: { isolation: 0.1, service_gap: 0.1, future_pressure: 0.1, inclusion: 1 },
  },
];
