/**
 * Validates and clamps anything that claims to be an action, whichever mode produced it.
 * A bad action is dropped, never repaired by guessing.
 */
import {
  DEFAULT_STATE,
  MAX_ACTIONS,
  MAX_BUDGET_EUR,
  MAX_CIRC,
  MAX_MIN_OVER75,
  MIN_BUDGET_EUR,
  MIN_CIRC,
  PROFILES,
} from "./contract.js";
import type {
  Action,
  AppState,
  ChatMessage,
  Filters,
  PlanItem,
  Profile,
  Weights,
} from "./contract.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isProfile(value: unknown): value is Profile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

const WEIGHT_KEYS = ["isolation", "service_gap", "future_pressure", "inclusion"] as const;

/** Rounds to 3 decimals so weights stay readable in the UI. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function validateAction(raw: unknown): Action | null {
  if (!isRecord(raw) || typeof raw.tool !== "string") return null;
  const args = isRecord(raw.args) ? raw.args : {};

  switch (raw.tool) {
    case "set_profile": {
      if (!isProfile(args.profile)) return null;
      return { tool: "set_profile", args: { profile: args.profile } };
    }
    case "set_budget": {
      const budget = toFiniteNumber(args.budget_eur);
      if (budget === null || budget <= 0) return null;
      return {
        tool: "set_budget",
        args: { budget_eur: Math.round(clamp(budget, MIN_BUDGET_EUR, MAX_BUDGET_EUR)) },
      };
    }
    case "set_weights": {
      const clamped = {} as Weights;
      for (const key of WEIGHT_KEYS) {
        const value = toFiniteNumber(args[key]);
        if (value === null) return null;
        clamped[key] = clamp(value, 0, 1);
      }
      const total = WEIGHT_KEYS.reduce((sum, key) => sum + clamped[key], 0);
      if (total <= 0) return null;
      // Always sums to 1, so the "weighted mean" in the scoring stays a true mean.
      const weights = {} as Weights;
      for (const key of WEIGHT_KEYS) weights[key] = round3(clamped[key] / total);
      const largest = WEIGHT_KEYS.reduce((best, key) => (weights[key] > weights[best] ? key : best));
      const residual = 1 - WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
      weights[largest] = round3(weights[largest] + residual);
      return { tool: "set_weights", args: weights };
    }
    case "filter_zones": {
      const out: { circ?: number[]; exclude_funded?: boolean; min_over75?: number } = {};
      if (Array.isArray(args.circ)) {
        const circ = args.circ
          .map(toFiniteNumber)
          .filter((n): n is number => n !== null && Number.isInteger(n))
          .filter((n) => n >= MIN_CIRC && n <= MAX_CIRC);
        // An empty list means "no filter", so a list of only invalid values must not become one.
        if (args.circ.length === 0 || circ.length > 0) {
          out.circ = [...new Set(circ)].sort((a, b) => a - b);
        }
      }
      if (typeof args.exclude_funded === "boolean") out.exclude_funded = args.exclude_funded;
      const minOver75 = toFiniteNumber(args.min_over75);
      if (minOver75 !== null) out.min_over75 = Math.round(clamp(minOver75, 0, MAX_MIN_OVER75));
      if (Object.keys(out).length === 0) return null;
      return { tool: "filter_zones", args: out };
    }
    case "run_plan":
      return { tool: "run_plan", args: {} };
    case "select_zone": {
      const zoneId = toFiniteNumber(args.zone_id);
      if (zoneId === null || !Number.isInteger(zoneId) || zoneId < 0) return null;
      return { tool: "select_zone", args: { zone_id: zoneId } };
    }
    case "write_memo":
      return { tool: "write_memo", args: {} };
    default:
      return null;
  }
}

export interface ValidatedActions {
  actions: Action[];
  dropped: number;
}

export function validateActions(raw: unknown): ValidatedActions {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0 };
  const actions: Action[] = [];
  let dropped = 0;
  for (const item of raw) {
    const action = validateAction(item);
    if (action && actions.length < MAX_ACTIONS) actions.push(action);
    else dropped += 1;
  }
  return { actions, dropped };
}

/** Accepts whatever the client sent as state and fills gaps from the contract defaults. */
export function normalizeState(raw: unknown): AppState {
  const base = DEFAULT_STATE;
  if (!isRecord(raw)) return structuredClone(base);

  const weights = { ...base.weights };
  if (isRecord(raw.weights)) {
    for (const key of WEIGHT_KEYS) {
      const value = toFiniteNumber(raw.weights[key]);
      if (value !== null) weights[key] = clamp(value, 0, 1);
    }
  }

  const filters: Filters = { ...base.filters, circ: [...base.filters.circ] };
  if (isRecord(raw.filters)) {
    if (Array.isArray(raw.filters.circ)) {
      filters.circ = raw.filters.circ
        .map(toFiniteNumber)
        .filter((n): n is number => n !== null && n >= MIN_CIRC && n <= MAX_CIRC);
    }
    if (typeof raw.filters.exclude_funded === "boolean") {
      filters.exclude_funded = raw.filters.exclude_funded;
    }
    const minOver75 = toFiniteNumber(raw.filters.min_over75);
    if (minOver75 !== null) filters.min_over75 = Math.max(0, minOver75);
  }

  const budget = toFiniteNumber(raw.budget_eur);
  const selected = toFiniteNumber(raw.selected_zone_id);

  return {
    profile: isProfile(raw.profile) ? raw.profile : base.profile,
    budget_eur: budget !== null && budget > 0 ? budget : base.budget_eur,
    weights,
    filters,
    selected_zone_id: selected,
    plan: Array.isArray(raw.plan) ? (raw.plan as PlanItem[]) : [],
  };
}

/** Keeps only well-formed chat turns, dropping empty or unknown-role entries. */
export function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (typeof item.content !== "string" || item.content.trim() === "") continue;
    out.push({ role: item.role, content: item.content });
  }
  return out;
}

/** Text of the last user turn, or an empty string. */
export function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === "user") return message.content;
  }
  return "";
}
