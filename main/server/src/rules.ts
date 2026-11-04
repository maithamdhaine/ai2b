/**
 * Rules mode: the demo fallback. A deterministic Italian parser that needs no network.
 * Actions come from the last user message only. Earlier user messages only feed budgetKnown.
 * Replies only use numbers the user wrote, so nothing here can invent a figure.
 */
import { DEFAULT_STATE, MAX_CIRC, MIN_CIRC } from "./contract.js";
import type { Action, AgentResponse, AppState, ChatMessage, FilterZonesArgs, Profile } from "./contract.js";
import { parseItalianNumberWord, parseNumeric, stripAccents } from "./numbers.js";
import { PROFILE_FOCUS, PROFILE_LABEL, PROFILE_WEIGHTS, weightsFor } from "./profiles.js";
import type { Goal } from "./profiles.js";
import { normalizeState, validateAction } from "./validate.js";

function normalize(text: unknown): string {
  if (typeof text !== "string") return "";
  return stripAccents(text.toLowerCase())
    .replace(/[  ]/g, " ")
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUM = String.raw`\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const MONEY_AHEAD = String.raw`k\b|mila\b|mln\b|milion|miliard|euro\b|eur\b|€`;
/** After an id-like number (circoscrizione, zona): it must not run on into a figure or an amount of money. */
const ID_END = String.raw`(?!\d|[.,]\d|\s?(?:${MONEY_AHEAD}))`;
// Later list items are at most two digits, so "circoscrizioni 3 e 5000" keeps its 5000 for the budget.
const CIRC_LIST = String.raw`\bcirc(?:oscrizion[ei])?\b\.?\s*(?:n\.?\s*|numero\s+)?(\d{1,3}${ID_END}(?:(?:\s*,\s*|\s+e\s+|\s+ed\s+|\s*/\s*)\d{1,2}${ID_END})*)`;
const ZONE_ID = String.raw`\bzona\s+(?:n\.?\s*|numero\s+)?(\d{1,4}${ID_END})`;

const MIN_OVER75 = String.raw`\b(?:almeno|minimo|piu di|oltre|sopra|con)\s+(?:di\s+)?(${NUM}|[a-z]+)\s+(?:persone\s+|anziani\s+)?(?:over|ultra)[\s-]?75\b`;

function digitsValue(raw: string): number | null {
  // "200,000" is a thousands separator typed the English way, not two hundred point zero.
  if (/^\d{1,3}(?:,\d{3})+$/.test(raw)) return Number(raw.replace(/,/g, ""));
  // normalize() turns every thousands space into a plain one, which parseNumeric does not accept.
  return parseNumeric(raw.replace(/ /g, "."))?.value ?? null;
}

/** Finds "almeno 500 over 75" and returns the text without it, so it cannot read as a goal or a budget. */
function extractMinOver75(text: string): { value: number | null; rest: string } {
  let value: number | null = null;
  const rest = text.replace(new RegExp(MIN_OVER75, "g"), (match: string, raw: string) => {
    const parsed = /^\d/.test(raw) ? digitsValue(raw) : parseItalianNumberWord(raw);
    if (parsed === null || parsed <= 1) return match;
    value ??= Math.round(parsed);
    return " ";
  });
  return { value, rest };
}

function maskNonBudget(text: string): string {
  return extractMinOver75(text)
    .rest.replace(new RegExp(CIRC_LIST, "g"), " ")
    .replace(new RegExp(ZONE_ID, "g"), " ")
    .replace(/\b(?:over|ultra)[\s-]?\d{1,3}(?:enni)?\b/g, " ")
    .replace(/\b\d{2}\s?[-–]\s?\d{2}\b(?:\s?anni)?/g, " ")
    .replace(/\b\d{1,3}\s?(?:anni|enni)\b/g, " ")
    .replace(/\d+(?:[.,]\d+)?\s?(?:%|per\s?cento)/g, " ");
}

const CURRENCY_AFTER = /^\s*(?:di\s+)?(?:euro\b|eur\b|€)/;
const CURRENCY_BEFORE = /(?:€|\beuro|\beur)\s*$/;
/** "budget di 2000" is money, not a year. "budget 2026 di 300k" keeps the year out on purpose. */
const BUDGET_LABEL_BEFORE = /\bbudget\s+(?:di|da|pari a)\s+(?:circa\s+)?$/;
const NOT_MONEY_AFTER =
  /^\s*(?:over|ultra|anzian[ioe]|persone|abitanti|residenti|utenti|famiglie|beneficiari|metri|km|m|mq|zone|progetti|interventi)\b/;
/** "300k invece di 200k": the second figure is the one being replaced. */
const REPLACED_BEFORE = /(?:\binvece d(?:i|ei)|\banziche|\bal posto d(?:i|ei)|\bnon)\s+$/;

const SCALE_FACTOR: Array<[RegExp, number]> = [
  [/^k$|^mila$/, 1_000],
  [/^mln$|^milion/, 1_000_000],
  [/^miliard/, 1_000_000_000],
];

function scaleOf(word: string): number {
  for (const [pattern, factor] of SCALE_FACTOR) if (pattern.test(word)) return factor;
  return 1;
}

function isYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

/** "un milione e mezzo": the half that follows a figure in millions, and where the figure then ends. */
function halfAfter(text: string, end: number, scale: string): { half: number; end: number } {
  if (scaleOf(scale) !== 1_000_000) return { half: 0, end };
  const found = /^\s+e\s+mezzo\b/.exec(text.slice(end));
  return found ? { half: 0.5, end: end + found[0].length } : { half: 0, end };
}

interface BudgetCandidate {
  value: number;
  index: number;
  /** Carries a currency, a scale or a number word. A bare integer is only used when nothing better exists. */
  strong: boolean;
}

function budgetCandidates(text: string): BudgetCandidate[] {
  const out: BudgetCandidate[] = [];

  const consider = (
    index: number,
    end: number,
    value: number | null,
    kind: "bare" | "dotted" | "scaled" | "word",
  ): void => {
    if (value === null || !Number.isFinite(value) || value <= 0) return;
    const before = text.slice(0, index);
    const after = text.slice(end);
    if (REPLACED_BEFORE.test(before)) return;
    if (/\bda\s+$/.test(before) && /^\s+a\s+\d/.test(after)) return; // "da 200k a 300k"
    const currency = CURRENCY_AFTER.test(after) || CURRENCY_BEFORE.test(before) || BUDGET_LABEL_BEFORE.test(before);
    if (!currency) {
      if (NOT_MONEY_AFTER.test(after)) return;
      // Only a plain "2030" can be a year. "2.030" has a thousands separator.
      if (kind === "bare" && isYear(value)) return;
      if ((kind === "bare" || kind === "dotted") && (!Number.isInteger(value) || value < 1000)) return;
      if (kind === "word" && (value <= 1000 || isYear(value))) return; // "mille grazie", "duemilatrenta"
    }
    if (kind === "word" && value < 1000) return; // "cento", "dieci"
    out.push({ value, index, strong: currency || kind === "scaled" || kind === "word" });
  };

  const digits = new RegExp(String.raw`(?<![\w.,])(${NUM})(?:\s?(k|mila|mln|milion[ei]|miliard[oi]))?(?![a-z0-9])`, "g");
  for (const match of text.matchAll(digits)) {
    const raw = match[1] ?? "";
    const base = digitsValue(raw);
    if (base === null) continue;
    const scale = match[2];
    const matchEnd = match.index + match[0].length;
    if (scale) {
      const { half, end } = halfAfter(text, matchEnd, scale);
      consider(match.index, end, (base + half) * scaleOf(scale), "scaled");
    } else {
      consider(match.index, matchEnd, base, /[. ,]/.test(raw) ? "dotted" : "bare");
    }
  }

  const words = /\b([a-z]+)\s+(mila|mln|milion[ei]|miliard[oi])\b|\b([a-z]+)\b/g;
  for (const match of text.matchAll(words)) {
    const matchEnd = match.index + match[0].length;
    const scaledWord = match[1];
    const scale = match[2];
    if (scaledWord && scale) {
      const base = scaledWord === "mezzo" ? 0.5 : parseItalianNumberWord(scaledWord);
      if (base === null) continue;
      const { half, end } = halfAfter(text, matchEnd, scale);
      consider(match.index, end, (base + half) * scaleOf(scale), "scaled");
    } else if (match[3]) {
      consider(match.index, matchEnd, parseItalianNumberWord(match[3]), "word");
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Euros stated in the text, or null if it states no budget. */
export function parseBudget(text: string): number | null {
  const normalized = normalize(text);
  if (normalized === "") return null;
  const candidates = budgetCandidates(maskNonBudget(normalized));
  const chosen = candidates.find((candidate) => candidate.strong) ?? candidates[0];
  return chosen ? Math.round(chosen.value) : null;
}

/** True if any user message states a budget, or the state shows one was already chosen. */
export function budgetKnown(messages: ChatMessage[], state: AppState): boolean {
  if (typeof state?.budget_eur === "number" && state.budget_eur !== DEFAULT_STATE.budget_eur) return true;
  if (Array.isArray(state?.plan) && state.plan.length > 0) return true;
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => message?.role === "user" && parseBudget(message.content) !== null);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const CLITICS = new Set(["mi", "ci", "ti", "vi", "si"]);
const STRONG_EXCLUSION = new Set(["tranne", "eccetto", "escludi", "escludere", "esclusa", "escluso", "evita", "togli"]);

/** True when "non" or "senza" sits within the three words before the position, in the same clause. */
function isNegated(text: string, index: number, alsoNegating: Set<string> = new Set()): boolean {
  const clause = text.slice(0, index).split(/[.,;:!?]/).pop() ?? "";
  const words = clause.split(" ").filter((word) => word !== "" && !CLITICS.has(word));
  const window = words.slice(-3);
  const start = words.length - window.length;
  return window.some((word, offset) => {
    if (word === "senza" || alsoNegating.has(word)) return true;
    if (word !== "non") return false;
    const next = words[start + offset + 1];
    return next !== "solo" && next !== "soltanto"; // "non solo gli anziani" still wants them
  });
}

const GOAL_PATTERNS: Array<[Goal, RegExp]> = [
  [
    "isolation",
    /\b(?:over|ultra)[\s-]?(?:75|65)\b|\banzian[ioe]\b|\bpersone sole\b|\bsolitudine\b|\bisolamento\b|\bisolat[ie]\b|\bvivono sol[ie]\b/g,
  ],
  [
    "service_gap",
    /\bcarenz[ae] (?:di |dei )?servizi\b|\bmancanza (?:di |dei )?servizi\b|\bmancano (?:i )?servizi\b|\bservizi scarsi\b|\bservizi lontani\b|\bsenza servizi\b|\bzone scoperte\b|\bvuot[io] di assistenza\b|\blontan[ie] dai servizi\b|\bpochi servizi\b|\bfarmacie\b|\bpresidi sanitari\b|\baccesso alla salute\b|\baccesso sanitario\b/g,
  ],
  [
    "future_pressure",
    /\bpressione futura\b|\binvecchiamento\b|\b2030\b(?!\s*(?:euro\b|eur\b|€))|\bprossimi anni\b|\bprevision[ei]\b|\bfutur[oae]\b/g,
  ],
  [
    "inclusion",
    // "lavoro per il comune" is the speaker's job, not a goal.
    /\binclusione\b|\binserimento lavorativo\b|\blavoro\b(?!\s+(?:per|in|con|presso|nel|nella|al|alla)\b)|\blavorativ[aoei]\b|\boccupazione\b|\bdisoccupa\w+\b|\b(?:over|ultra)[\s-]?50\b|\bnuovi residenti\b|\bstranier[ie]\b|\bmigranti\b|\bbarriere linguistiche\b|\blingua\b/g,
  ],
];

/** "persone senza lavoro", "zone senza farmacie": the missing thing is the need, so "senza" does not negate it. */
const NEED_AFTER_SENZA = /^(?:lavoro|occupazione|farmacie|presidi sanitari)\b/;

function detectGoals(text: string): Goal[] {
  const goals: Goal[] = [];
  for (const [goal, pattern] of GOAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const namesTheNeed = NEED_AFTER_SENZA.test(match[0]) && /\bsenza\s+$/.test(text.slice(0, match.index));
      if (namesTheNeed || !isNegated(text, match.index)) {
        goals.push(goal);
        break;
      }
    }
  }
  return goals;
}

const PROFILE_PATTERNS: Array<[Profile, RegExp]> = [
  ["foundation", /\bfondazione\b/g],
  ["third_sector", /\bterzo settore\b|\bassociazione\b|\bcooperativa\b|\bets\b|\bonlus\b/g],
  [
    "institution",
    // "bene comune" and "in comune" are not the municipality. "circoscrizione" is never a profile.
    /\bassessorato\b|\bente pubblico\b|\bistituzione\b|\bregione\b|(?<!\b(?:in|bene|senso|problema|obiettivo|interesse|uso)\s)\bcomune\b/g,
  ],
];
/** "già finanziate dalla fondazione", "con il comune": someone else, not the speaker. */
const NOT_SPEAKER_BEFORE = /\b(?:dal|dalla|dall'|con il|con la|con l'|col)\s*$/;

function detectProfile(text: string): Profile | null {
  let best: { profile: Profile; index: number } | null = null;
  for (const [profile, pattern] of PROFILE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (NOT_SPEAKER_BEFORE.test(text.slice(0, match.index))) continue;
      if (!best || match.index < best.index) best = { profile, index: match.index };
      break;
    }
  }
  return best ? best.profile : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface NamedArea {
  circ: number;
  label: string;
  pattern: RegExp;
}

function area(circ: number, label: string, pattern?: RegExp): NamedArea {
  const source = normalize(label).split(" ").map(escapeRegExp).join("[\\s-]+");
  return { circ, label, pattern: pattern ?? new RegExp(`\\b${source}\\b`, "g") };
}

const NAMED_AREAS: NamedArea[] = [
  // Only these phrases name the district: "centro anziani" and "al centro" are ordinary Italian.
  area(1, "Centro", /\b(?:in|zona) centro\b(?! (?:anziani|diurno|sociale|giovani|servizi)\b)|\bcentro storico\b/g),
  area(1, "Crocetta"),
  area(2, "Santa Rita"),
  area(2, "Mirafiori"),
  // Compagnia di San Paolo and Intesa Sanpaolo are funders, not the neighbourhood.
  area(3, "San Paolo", /(?<!\b(?:compagnia di|intesa) )\bsan paolo\b/g),
  area(3, "Cenisia"),
  area(3, "Pozzo Strada"),
  area(3, "Cit Turin"),
  area(3, "Borgata Lesna"),
  area(4, "San Donato"),
  area(4, "Campidoglio"),
  area(4, "Parella"),
  area(5, "Borgo Vittoria"),
  area(5, "Madonna di Campagna"),
  area(5, "Lucento"),
  area(5, "Vallette"),
  area(6, "Barriera di Milano"),
  area(6, "Regio Parco"),
  area(6, "Barca"),
  area(6, "Bertolla"),
  area(6, "Falchera"),
  area(6, "Rebaudengo"),
  area(6, "Villaretto"),
  area(7, "Aurora"),
  area(7, "Vanchiglietta"),
  area(7, "Vanchiglia"),
  area(7, "Madonna del Pilone"),
  area(7, "Sassi"),
  area(8, "San Salvario"),
  area(8, "Cavoretto"),
  area(8, "Borgo Po"),
  area(8, "Nizza Millefonti"),
  area(8, "Lingotto"),
  area(8, "Filadelfia"),
];

interface CircResult {
  numbers: number[];
  invalid: number[];
  areas: NamedArea[];
}

function detectCirc(text: string): CircResult {
  const numbers: number[] = [];
  const invalid: number[] = [];
  for (const match of text.matchAll(new RegExp(CIRC_LIST, "g"))) {
    for (const digits of (match[1] ?? "").match(/\d+/g) ?? []) {
      const value = Number(digits);
      if (value >= MIN_CIRC && value <= MAX_CIRC) {
        if (!numbers.includes(value)) numbers.push(value);
      } else if (!invalid.includes(value)) {
        invalid.push(value);
      }
    }
  }
  const areas: NamedArea[] = [];
  for (const named of NAMED_AREAS) {
    for (const match of text.matchAll(named.pattern)) {
      if (!isNegated(text, match.index, STRONG_EXCLUSION)) {
        areas.push(named);
        break;
      }
    }
  }
  return { numbers, invalid, areas };
}

const RESET_FILTERS =
  /\b(?:togli|rimuovi|azzera|resetta|reset)\b(?: (?:tutti|i|dei|di))* filtri\b|\btutta la citta\b|\btutte le circoscrizioni\b/;

const INCLUDE_FUNDED =
  /\bnon evit\w+|\bnon esclud\w+|\bincludi\w*\b[^.;,]*\b(?:finanziat\w+|copert\w+|pnrr)\b|\bcompres[ei]\b[^.;,]*\b(?:finanziat\w+|copert\w+)\b|\banche (?:le )?(?:zone )?gia (?:finanziat\w+|copert\w+)\b/;
const EXCLUDE_FUNDED =
  /\bevit\w+\b[^.;,]*\b(?:pnrr|sovrapposizion\w+|finanziat\w+|copert\w+)\b|\bgia (?:coperte|finanziate)\b|\bnon (?:ancora |gia )?(?:coperte|finanziate)\b|\b(?:senza|niente|no|esclud\w+|fuori dal) (?:il |le )?(?:pnrr|sovrapposizion\w+)\b/;

function detectExcludeFunded(text: string): boolean | null {
  if (INCLUDE_FUNDED.test(text)) return false;
  if (EXCLUDE_FUNDED.test(text)) return true;
  return null;
}

const EXPLICIT_RUN =
  /\bricalcol\w+|\b(?:calcola|genera|rigenera|rifai|crea|aggiorna)\b(?: (?:di nuovo|il|un|ancora))* piano\b|\bdove (?:investire|investiamo|investo|conviene)\b/;
const WRITE_MEMO =
  /\bmemo\b|\bbrief\b|\b(?:nota|relazione|documento) per il (?:consiglio|cda)\b/g;

function detectMemo(text: string): boolean {
  for (const match of text.matchAll(WRITE_MEMO)) {
    if (!isNegated(text, match.index)) return true;
  }
  return false;
}

interface ZoneChoice {
  id: number;
  /** The plan's name for the zone, when the plan holds it. */
  name: string | null;
  /** Text that named the zone, which must not also read as a named area. */
  matched: string | null;
}

const ZONE_VERB = /\b(?:apri(?:mi|re|amo)?|mostra\w*|seleziona\w*|vai|dettagl[io])\b/;

function detectZone(text: string, plan: AppState["plan"]): ZoneChoice | null {
  const items = Array.isArray(plan) ? plan.filter((item) => Number.isInteger(item?.zone_id) && item.zone_id >= 0) : [];
  for (const match of text.matchAll(new RegExp(ZONE_ID, "g"))) {
    if (isNegated(text, match.index, STRONG_EXCLUSION)) continue;
    const id = Number(match[1]);
    const known = items.find((item) => item.zone_id === id);
    return { id, name: typeof known?.zone_name === "string" ? known.zone_name : null, matched: null };
  }
  if (!ZONE_VERB.test(text)) return null;
  let best: ZoneChoice | null = null;
  for (const item of items) {
    const name = normalize(item.zone_name);
    if (name.length < 3 || (best?.matched && best.matched.length >= name.length)) continue;
    const found = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(text);
    if (found && !isNegated(text, found.index, STRONG_EXCLUSION)) {
      best = { id: item.zone_id, name: item.zone_name, matched: name };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

function formatInt(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatEuro(value: number): string {
  return `${formatInt(value)} €`;
}

function joinItalian(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const GOAL_DATIVE: Record<Goal, string> = {
  isolation: "all'isolamento degli anziani",
  service_gap: "alla carenza di servizi",
  future_pressure: "alla pressione futura",
  inclusion: "all'inclusione",
};
/** Foreign residents are an access and language need, never a risk. */
const INCLUSION_ACCESS_DATIVE = "all'inclusione e alle barriere di accesso e di lingua";
const ACCESS_NEED = /\bstranier[ie]\b|\bmigranti\b|\bnuovi residenti\b|\bbarriere linguistiche\b|\blingua\b/;

const PROFILE_DATIVE: Record<Profile, string> = {
  foundation: "per la fondazione",
  third_sector: "per l'ente del terzo settore",
  institution: "per l'istituzione pubblica",
};

function goalList(goals: Goal[], text: string): string {
  const parts = goals.map((goal) =>
    goal === "inclusion" && ACCESS_NEED.test(text) ? INCLUSION_ACCESS_DATIVE : GOAL_DATIVE[goal],
  );
  return joinItalian(parts);
}

function invalidCircNote(invalid: number[]): string {
  if (invalid.length === 0) return "";
  const list = joinItalian(invalid.map(String));
  return invalid.length === 1
    ? `La circoscrizione ${list} non esiste a Torino, quindi l'ho ignorata. `
    : `Le circoscrizioni ${list} non esistono a Torino, quindi le ho ignorate. `;
}

/** Named areas stay names: the user wrote "Barriera di Milano", not a circoscrizione number. */
function circPhrase(circ: CircResult): string | null {
  const places = [...circ.numbers.map(String), ...circ.areas.map((named) => `di ${named.label}`)];
  if (places.length === 0) return null;
  const distinct = new Set([...circ.numbers, ...circ.areas.map((named) => named.circ)]).size;
  return `solo ${distinct === 1 ? "sulla circoscrizione" : "sulle circoscrizioni"} ${joinItalian(places)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const GOAL_QUESTION =
  "Su cosa vuoi concentrare i fondi: isolamento degli anziani, carenza di servizi o inclusione?";

function goalClarification(invalid: number[] = []): AgentResponse {
  return {
    reply: `${invalidCircNote(invalid)}${GOAL_QUESTION}`,
    actions: [],
    needs_clarification: true,
    mode: "rules",
  };
}

function budgetQuestion(goals: Goal[], profile: Profile | null, hasCircOrArea: boolean, text: string): string {
  if (goals.length > 0) return `Quale budget vuoi destinare ${goalList(goals, text)}?`;
  if (profile) return `Quale budget hai a disposizione come ${PROFILE_LABEL[profile]}?`;
  if (hasCircOrArea) return "Quale budget vuoi destinare a queste zone?";
  return "Quale budget hai a disposizione?";
}

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

function lastUserContent(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Partial<ChatMessage> | null | undefined;
    if (message?.role === "user") return typeof message.content === "string" ? message.content : "";
  }
  return "";
}

function validated(raw: Action[]): Action[] {
  const out: Action[] = [];
  for (const action of raw) {
    const clean = validateAction(action);
    if (clean) out.push(clean);
  }
  return out;
}

const MONEY_FIGURE = String.raw`(?:€\s*)?(?:\d|[a-z]*mila\b|un milione|mezzo milione|[a-z]+ milioni)`;
const SCALES_THE_BUDGET = /\b(?:raddoppi|dimezz|triplic)\w*\b[^.;]{0,25}\b(?:budget|fondi|cifra|importo|stanziamento)\b/;
const CHANGES_BY_A_FIGURE = [
  new RegExp(String.raw`\b(?:togli\w*|sottra\w*|aggiung\w*)\b[^.;,]{0,25}?\b${MONEY_FIGURE}`),
  new RegExp(String.raw`\b(?:aument|alz|increment|riduc|ridur|abbass|diminu|tagli)\w*\b[^.;,]{0,25}?\bdi\s+(?:circa\s+)?${MONEY_FIGURE}`),
  new RegExp(String.raw`\baltri\s+${MONEY_FIGURE}`),
  /(?:\d|k|mila|euro|€)\s+in (?:piu|meno)\b/,
];

/**
 * "togli 50k", "aumenta di 50k", "50k in più", "raddoppia il budget": a change to the current budget, not a new one.
 * The figure in it is not the budget, and nothing on the server may calculate the total.
 */
export function isRelativeBudgetChange(input: string): boolean {
  const text = maskNonBudget(normalize(input));
  if (SCALES_THE_BUDGET.test(text)) return true;
  return parseBudget(input) !== null && CHANGES_BY_A_FIGURE.some((pattern) => pattern.test(text));
}

function answer(messages: ChatMessage[], rawState: AppState): AgentResponse {
  const state = normalizeState(rawState);
  const text = normalize(lastUserContent(messages));
  if (text === "") return goalClarification();
  if (isRelativeBudgetChange(text)) {
    return { reply: "Qual è il nuovo budget totale, in euro?", actions: [], needs_clarification: true, mode: "rules" };
  }

  const budget = parseBudget(text);
  const { value: minOver75, rest: withoutMin } = extractMinOver75(text);
  const profile = detectProfile(withoutMin);
  const goals = detectGoals(withoutMin);
  const zone = detectZone(text, state.plan);
  const circ = detectCirc(zone?.matched ? text.split(zone.matched).join(" ") : text);
  const excludeFunded = detectExcludeFunded(text);
  const reset = RESET_FILTERS.test(text);
  const memoAsked = detectMemo(text);
  const explicitRun = EXPLICIT_RUN.test(text);

  const filter: FilterZonesArgs = reset ? { circ: [], exclude_funded: false, min_over75: 0 } : {};
  const circValues = [...circ.numbers, ...circ.areas.map((named) => named.circ)];
  if (circValues.length > 0) filter.circ = circValues;
  if (excludeFunded !== null) filter.exclude_funded = excludeFunded;
  if (minOver75 !== null) filter.min_over75 = minOver75;
  const hasFilter = Object.keys(filter).length > 0;

  const activeProfile = profile ?? state.profile;
  const weights = goals.length > 0 ? weightsFor(goals, activeProfile) : profile ? PROFILE_WEIGHTS[profile] : null;

  const expressedSettings = profile !== null || goals.length > 0 || hasFilter;
  const needsBudget = expressedSettings && budget === null && !budgetKnown(messages, state);
  const changed = profile !== null || budget !== null || weights !== null || hasFilter;

  if (!changed && !explicitRun && !memoAsked && !zone) return goalClarification(circ.invalid);

  const runPlan = !needsBudget && (changed || explicitRun || (memoAsked && state.plan.length === 0));
  const writeMemo = !needsBudget && memoAsked;

  const raw: Action[] = [];
  if (profile) raw.push({ tool: "set_profile", args: { profile } });
  if (budget !== null) raw.push({ tool: "set_budget", args: { budget_eur: budget } });
  if (weights) raw.push({ tool: "set_weights", args: { ...weights } });
  if (hasFilter) raw.push({ tool: "filter_zones", args: filter });
  if (runPlan) raw.push({ tool: "run_plan", args: {} });
  if (zone) raw.push({ tool: "select_zone", args: { zone_id: zone.id } });
  if (writeMemo) raw.push({ tool: "write_memo", args: {} });
  const actions = validated(raw);

  if (needsBudget) {
    const question = budgetQuestion(goals, profile, circValues.length > 0, withoutMin);
    return {
      reply: `${invalidCircNote(circ.invalid)}${question}`,
      actions,
      needs_clarification: true,
      mode: "rules",
    };
  }

  const steps: string[] = [];
  if (runPlan) {
    const withParts: string[] = [];
    const budgetAction = actions.find((action) => action.tool === "set_budget");
    if (budget !== null && budgetAction?.tool === "set_budget") {
      withParts.push(
        budgetAction.args.budget_eur === budget
          ? `budget di ${formatEuro(budget)}`
          : "budget portato al limite consentito dal planner",
      );
    }
    if (goals.length > 0) withParts.push(`priorità ${goalList(goals, withoutMin)}`);

    const details: string[] = [];
    if (withParts.length > 0) details.push(`con ${joinItalian(withParts)}`);
    const onlyCirc = circPhrase(circ);
    if (onlyCirc) details.push(onlyCirc);
    if (excludeFunded === true) details.push("senza le zone già finanziate");
    if (excludeFunded === false && !reset) details.push("incluse le zone già finanziate");
    if (minOver75 !== null) {
      const filterAction = actions.find((action) => action.tool === "filter_zones");
      const applied = filterAction?.tool === "filter_zones" ? filterAction.args.min_over75 : undefined;
      details.push(
        applied === minOver75
          ? `solo zone con almeno ${formatInt(minOver75)} over 75`
          : "solo zone con la soglia massima di over 75 consentita",
      );
    }
    if (reset) details.push("senza filtri");

    const who = profile ? ` ${PROFILE_DATIVE[profile]}` : "";
    const how = details.length > 0 ? ` ${details.join(", ")}` : changed ? "" : " con le impostazioni attuali";
    steps.push(`ricalcolo il piano${who}${how}`);
  }
  if (zone) steps.push(`apro ${zone.name ?? `la zona ${zone.id}`}`);
  if (writeMemo) steps.push("preparo il memo");

  const main = `${capitalize(joinItalian(steps))}.`;
  // Two sentences at most: the ignored circoscrizione takes the place of the focus line.
  const reply =
    circ.invalid.length > 0
      ? `${invalidCircNote(circ.invalid)}${main}`
      : `${main} In primo piano: ${PROFILE_FOCUS[activeProfile]}.`;

  return { reply, actions, needs_clarification: false, mode: "rules" };
}

/** Pure and deterministic. Never throws: anything unexpected falls back to the goal question. */
export function runRules(messages: ChatMessage[], state: AppState): AgentResponse {
  try {
    return answer(messages, state);
  } catch {
    return goalClarification();
  }
}
