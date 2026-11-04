// Shared contract. Change only with the agreement of all three machines.
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';

export type Confidence = 'official' | 'estimated' | 'low';
export type Profile = 'foundation' | 'third_sector' | 'institution';
export type Lens = 'isolation' | 'service_gap' | 'future_pressure' | 'inclusion' | 'funded_share';
export type ServiceType = 'hospital' | 'rsa' | 'pharmacy' | 'library' | 'market';

export interface ZoneProps {
  id: number;
  name: string;
  circ: number;
  pop_2025: number;
  over65_est: number;
  over75_est: number;
  adults_50_64_est: number;
  over75_2030: number | null;
  alone_rate_circ: number;
  foreign_share: number;
  isolation: number;
  service_gap: number;
  future_pressure: number;
  inclusion: number;
  funded_eur: number;
  funded_projects: number;
  funded_share: number;
  nearest: { health_m: number | null; care_m: number | null; pharmacy_m: number | null };
  services_800m: number;
  stability_top10: number | null;
  confidence: Confidence;
  small_zone: boolean;
}

export type ZoneFeature = Feature<Polygon | MultiPolygon, ZoneProps>;
export type ZoneCollection = FeatureCollection<Polygon | MultiPolygon, ZoneProps>;

export interface ServiceProps {
  id: string | number;
  name: string;
  type: ServiceType;
  address: string;
  source: string;
  year: number;
}
export type ServiceCollection = FeatureCollection<Point, ServiceProps>;

export interface FundedProject {
  id: string | number;
  title: string;
  programme: string;
  amount_eur: number;
  progress_pct: number | null;
  circ: number | null;
  zone_id: number | null;
  theme: string;
  source: string;
}

export interface SourceRef {
  key: string;
  label: string;
  url: string;
  year: number;
  level: string;
}

export interface Meta {
  mock: boolean;
  generated_at: string;
  sources: SourceRef[];
}

export type TargetField = 'over75_est' | 'over65_est' | 'adults_50_64_est';

export interface Intervention {
  id: string;
  label: string;
  target: TargetField;
  reach_share: number;
  fixed_eur: number;
  eur_per_person: number;
}

export interface Weights {
  isolation: number;
  service_gap: number;
  future_pressure: number;
  inclusion: number;
}

export interface Filters {
  circ: number[];
  exclude_funded: boolean;
  min_over75: number;
}

export interface PlanItem {
  zone_id: number;
  zone_name: string;
  circ: number;
  intervention_id: string;
  intervention_label: string;
  budget_eur: number;
  people_reached: number;
  cost_per_person_eur: number;
  return_index: number;
  scores: Weights & { funded_share: number };
  confidence: Confidence;
}

export interface PlannerState {
  profile: Profile;
  budget_eur: number;
  weights: Weights;
  filters: Filters;
  selected_zone_id: number | null;
  plan: PlanItem[];
}

export type Action =
  | { tool: 'set_profile'; args: { profile: Profile } }
  | { tool: 'set_budget'; args: { budget_eur: number } }
  | { tool: 'set_weights'; args: Weights }
  | { tool: 'filter_zones'; args: Partial<Filters> }
  | { tool: 'run_plan'; args: Record<string, never> }
  | { tool: 'select_zone'; args: { zone_id: number } }
  | { tool: 'write_memo'; args: Record<string, never> };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  reply: string;
  actions: Action[];
  needs_clarification: boolean;
  mode: 'llm' | 'rules';
}

export interface MemoResponse {
  markdown: string;
  mode: 'llm' | 'rules' | 'template';
}
