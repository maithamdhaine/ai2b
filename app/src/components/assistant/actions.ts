import { copyFor, type Lang } from '../../i18n';
import { postAgent } from '../../lib/api';
import { plannerState, useStore } from '../../store';
import type { Action, ChatMessage, Filters, Profile, Weights } from '../../types';
import { describeWeights } from '../memo/template';
import { CRITERIA, formatEur, formatInt } from '../planner/format';

export interface ChangeChip {
  text: string;
  applied: boolean;
}

export type AgentMode = 'llm' | 'rules' | 'offline';

export type Outcome =
  | { kind: 'reply'; asked: string; reply: string; clarification: boolean; chips: ChangeChip[] }
  | { kind: 'failure'; asked: string; message: string };

export interface CommandResult {
  outcome: Outcome;
  history: ChatMessage[];
  mode: AgentMode;
}

// Odd on purpose: the history alternates user and assistant and ends with the user,
// so an odd slice still starts with a user message, as the model API requires.
const MAX_MESSAGES_SENT = 13;

// A Map and not an object: the tool name comes from outside, and "toString" must not match.
const toolLabels = (lang: Lang) => new Map<unknown, string>(Object.entries(copyFor(lang).chips.tools));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const PROFILES: Profile[] = ['foundation', 'third_sector', 'institution'];

const isProfile = (value: unknown): value is Profile => (PROFILES as unknown[]).includes(value);

function toWeights(args: Record<string, unknown>): Weights | null {
  const weights = { ...useStore.getState().weights };
  let changed = false;
  for (const key of CRITERIA) {
    const value = args[key];
    if (value === undefined) continue;
    if (!isAmount(value) || value > 1) return null;
    weights[key] = value;
    changed = true;
  }
  return changed ? weights : null;
}

function toFilters(args: Record<string, unknown>): Partial<Filters> | null {
  const { circ, exclude_funded: excludeFunded, min_over75: minOver75 } = args;
  const filters: Partial<Filters> = {};
  if (circ != null) {
    if (!Array.isArray(circ) || !circ.every((value) => Number.isInteger(value))) return null;
    filters.circ = circ;
  }
  if (excludeFunded != null) {
    if (typeof excludeFunded !== 'boolean') return null;
    filters.exclude_funded = excludeFunded;
  }
  if (minOver75 != null) {
    if (!isAmount(minOver75)) return null;
    filters.min_over75 = minOver75;
  }
  return filters;
}

const zoneName = (id: number) =>
  useStore.getState().zones?.features.find((feature) => feature.properties.id === id)?.properties.name;

/**
 * The store trusts its input: a budget of NaN or a circ that is not an array would be saved
 * and would then break every later recompute, so a try/catch alone is not enough. Each action
 * is rebuilt from known fields here, and anything else is refused before it reaches the store.
 */
function toAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  const args = isRecord(raw.args) ? raw.args : {};

  switch (raw.tool) {
    case 'set_profile':
      return isProfile(args.profile) ? { tool: 'set_profile', args: { profile: args.profile } } : null;
    case 'set_budget':
      return isAmount(args.budget_eur) ? { tool: 'set_budget', args: { budget_eur: args.budget_eur } } : null;
    case 'set_weights': {
      const weights = toWeights(args);
      return weights && { tool: 'set_weights', args: weights };
    }
    case 'filter_zones': {
      const filters = toFilters(args);
      return filters && { tool: 'filter_zones', args: filters };
    }
    case 'run_plan':
      return { tool: 'run_plan', args: {} };
    case 'select_zone':
      return typeof args.zone_id === 'number' && zoneName(args.zone_id) !== undefined
        ? { tool: 'select_zone', args: { zone_id: args.zone_id } }
        : null;
    case 'write_memo':
      return { tool: 'write_memo', args: {} };
    default:
      return null;
  }
}

function describeCirc(circ: number[], lang: Lang): string {
  const t = copyFor(lang).chips;
  if (circ.length === 0) return t.allCirc;
  const sorted = [...circ].sort((a, b) => a - b);
  return sorted.length === 1 ? t.oneCirc(sorted[0]) : t.manyCirc(sorted.join(', '));
}

function describeFilters(
  { circ, exclude_funded: excludeFunded, min_over75: minOver75 }: Partial<Filters>, lang: Lang,
): string[] {
  const t = copyFor(lang).chips;
  const changes: string[] = [];
  if (circ) changes.push(describeCirc(circ, lang));
  if (excludeFunded !== undefined) changes.push(excludeFunded ? t.fundedExcluded : t.fundedIncluded);
  if (minOver75 !== undefined) {
    changes.push(minOver75 > 0 ? t.minOver75(formatInt(minOver75)) : t.noMinOver75);
  }
  return changes;
}

function describePlan(lang: Lang): string {
  const t = copyFor(lang);
  const { length } = useStore.getState().plan;
  return length === 0 ? t.chips.planEmpty : t.chips.plan(t.planner.interventionCount(length));
}

function describe(action: Action, lang: Lang): string[] {
  const c = copyFor(lang);
  const t = c.chips;
  switch (action.tool) {
    case 'set_profile': return [t.profile(c.planner.profiles[action.args.profile])];
    case 'set_budget': return [t.budget(formatEur(action.args.budget_eur))];
    case 'set_weights': return [t.weights(describeWeights(action.args, lang))];
    case 'filter_zones': return describeFilters(action.args, lang);
    case 'run_plan': return [describePlan(lang)];
    case 'select_zone': return [t.zone(zoneName(action.args.zone_id) ?? '')];
    case 'write_memo': return [t.memo];
  }
}

function ignored(raw: unknown, lang: Lang): ChangeChip {
  const t = copyFor(lang).chips;
  const tool = isRecord(raw) ? toolLabels(lang).get(raw.tool) : undefined;
  return { text: t.ignored(tool ?? t.unknownTool), applied: false };
}

/** Applies the actions in order. One bad action is skipped and reported, the others still run. */
export function applyAgentActions(actions: readonly unknown[], lang: Lang): ChangeChip[] {
  return actions.flatMap((raw) => {
    const action = toAction(raw);
    if (!action) return [ignored(raw, lang)];
    try {
      useStore.getState().applyAction(action);
      return describe(action, lang).map((text) => ({ text, applied: true }));
    } catch (error) {
      console.error('Action not applied', action, error);
      return [ignored(raw, lang)];
    }
  });
}

function fallbackReply(chips: ChangeChip[], lang: Lang): string {
  const t = copyFor(lang).chips;
  return chips.some(({ applied }) => applied) ? t.updated : t.notUnderstood;
}

/** One exchange with the server. Never rejects, and the planner only changes on a good reply. */
export async function runCommand(
  asked: string, history: ChatMessage[], lang: Lang,
): Promise<CommandResult> {
  const question: ChatMessage = { role: 'user', content: asked };
  const messages = [...history, question].slice(-MAX_MESSAGES_SENT);
  const result = await postAgent(messages, plannerState());

  // A request that failed is not part of the conversation, so the history always alternates.
  if (!result.ok) {
    return { outcome: { kind: 'failure', asked, message: result.message }, history, mode: 'offline' };
  }

  const { actions, needs_clarification: clarification, mode } = result.data;
  const chips = applyAgentActions(actions, lang);
  const reply = result.data.reply || fallbackReply(chips, lang);
  return {
    outcome: { kind: 'reply', asked, reply, clarification, chips },
    history: [...messages, { role: 'assistant', content: reply }],
    mode,
  };
}
