/**
 * Shared contract between Machine A (app), Machine B (this server) and Machine C (data).
 * Owned by the lead. Do not change it without telling all three teammates.
 */

export const PROFILES = ["foundation", "third_sector", "institution"] as const;
export type Profile = (typeof PROFILES)[number];

export const TOOL_NAMES = [
  "set_profile",
  "set_budget",
  "set_weights",
  "filter_zones",
  "run_plan",
  "select_zone",
  "write_memo",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type Mode = "llm" | "rules";

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

export interface PlanScores {
  isolation: number;
  service_gap: number;
  future_pressure: number;
  inclusion: number;
  funded_share: number;
}

export type Confidence = "official" | "estimated" | "low";

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
  scores: PlanScores;
  confidence: Confidence;
}

export interface AppState {
  profile: Profile;
  budget_eur: number;
  weights: Weights;
  filters: Filters;
  selected_zone_id: number | null;
  plan: PlanItem[];
}

/** The state the app sends when nothing has been chosen yet. */
export const DEFAULT_STATE: AppState = {
  profile: "foundation",
  budget_eur: 100000,
  weights: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  filters: { circ: [], exclude_funded: false, min_over75: 0 },
  selected_zone_id: null,
  plan: [],
};

export interface SetProfileArgs {
  profile: Profile;
}
export interface SetBudgetArgs {
  budget_eur: number;
}
export type SetWeightsArgs = Weights;
export interface FilterZonesArgs {
  circ?: number[];
  exclude_funded?: boolean;
  min_over75?: number;
}
export interface SelectZoneArgs {
  zone_id: number;
}
export type EmptyArgs = Record<string, never>;

export type Action =
  | { tool: "set_profile"; args: SetProfileArgs }
  | { tool: "set_budget"; args: SetBudgetArgs }
  | { tool: "set_weights"; args: SetWeightsArgs }
  | { tool: "filter_zones"; args: FilterZonesArgs }
  | { tool: "run_plan"; args: EmptyArgs }
  | { tool: "select_zone"; args: SelectZoneArgs }
  | { tool: "write_memo"; args: EmptyArgs };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** POST /api/agent request body. */
export interface AgentRequest {
  messages: ChatMessage[];
  state: AppState;
}

/** POST /api/agent response body. */
export interface AgentResponse {
  reply: string;
  actions: Action[];
  needs_clarification: boolean;
  mode: Mode;
}

/** Properties of one zone in zones.geojson. Nullable fields can be null. */
export interface ZoneProperties {
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
  nearest: { health_m: number; care_m: number; pharmacy_m: number | null };
  services_800m: number;
  stability_top10: number | null;
  confidence: Confidence;
  small_zone: boolean;
}

/** One entry of meta.json "sources". */
export interface Source {
  key: string;
  label: string;
  url: string;
  year: number;
  level: string;
}

/** POST /api/memo request body. */
export interface MemoRequest {
  state: AppState;
  plan: PlanItem[];
  zones: ZoneProperties[];
  sources: Source[];
  /** Optional addition to the contract: true when meta.json says mock, so the memo says DATI DI PROVA. */
  mock?: boolean;
}

/** POST /api/memo response body. */
export interface MemoResponse {
  markdown: string;
  mode: Mode;
}

/** GET /api/health response body. */
export interface HealthResponse {
  ok: true;
  mode: Mode;
}

/** Model named in the brief for all LLM calls. Overridable through ANTHROPIC_MODEL. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** Hard limit on one agent LLM call, from the brief. */
export const AGENT_TIMEOUT_MS = 8000;

export const MAX_ACTIONS = 12;
export const MAX_BUDGET_EUR = 50_000_000;
export const MIN_BUDGET_EUR = 1_000;
export const MIN_CIRC = 1;
export const MAX_CIRC = 8;
export const MAX_MIN_OVER75 = 100_000;
