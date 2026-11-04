/**
 * Funder profiles and goal presets, used by rules mode and by the LLM prompt. Owned by the lead.
 * These weights are planner settings chosen by the team. They are not data about Turin.
 */
import type { Profile, Weights } from "./contract.js";

export const PROFILE_WEIGHTS: Record<Profile, Weights> = {
  foundation: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  third_sector: { isolation: 0.35, service_gap: 0.25, future_pressure: 0.1, inclusion: 0.3 },
  institution: { isolation: 0.25, service_gap: 0.45, future_pressure: 0.2, inclusion: 0.1 },
};

export const PROFILE_LABEL: Record<Profile, string> = {
  foundation: "fondazione",
  third_sector: "ente del terzo settore",
  institution: "istituzione pubblica",
};

/** How the assistant frames its reply for each funder. */
export const PROFILE_FOCUS: Record<Profile, string> = {
  foundation: "impatto e difendibilità della scelta davanti al consiglio",
  third_sector: "evidenze da usare in un bando",
  institution: "copertura del territorio e sovrapposizioni con fondi già attivi",
};

export type Goal = "isolation" | "service_gap" | "future_pressure" | "inclusion";

export const GOAL_WEIGHTS: Record<Goal, Weights> = {
  isolation: { isolation: 0.6, service_gap: 0.2, future_pressure: 0.15, inclusion: 0.05 },
  service_gap: { isolation: 0.2, service_gap: 0.6, future_pressure: 0.15, inclusion: 0.05 },
  future_pressure: { isolation: 0.2, service_gap: 0.2, future_pressure: 0.55, inclusion: 0.05 },
  inclusion: { isolation: 0.15, service_gap: 0.15, future_pressure: 0.1, inclusion: 0.6 },
};

const KEYS = ["isolation", "service_gap", "future_pressure", "inclusion"] as const;

/** Share of the final weights that comes from the goal. The rest comes from the funder profile. */
const GOAL_SHARE = 0.75;

/**
 * Weights for the stated goals, shaped by the funder profile.
 * With no goal the profile preset is returned unchanged.
 */
export function weightsFor(goals: Goal[], profile: Profile): Weights {
  const base = PROFILE_WEIGHTS[profile];
  if (goals.length === 0) return { ...base };
  const out = {} as Weights;
  for (const key of KEYS) {
    const goalMean = goals.reduce((sum, goal) => sum + GOAL_WEIGHTS[goal][key], 0) / goals.length;
    out[key] = Math.round((GOAL_SHARE * goalMean + (1 - GOAL_SHARE) * base[key]) * 1000) / 1000;
  }
  return out;
}
