/**
 * Number checking shared by the memo and the agent reply. Owned by the lead.
 *
 * Rule from the brief: every figure in generated text must appear in the supplied payload.
 * Rounding to the shown precision is accepted (payload 0.0423, text "0,04").
 * A fraction may be shown as a percentage only with a percent sign (0.42, "42%").
 */

export interface NumberToken {
  raw: string;
  value: number;
  /** Digits after the decimal separator, as written in the text. */
  decimals: number;
  percent: boolean;
}

const UNITS: Record<string, number> = {
  zero: 0, uno: 1, un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7,
  otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14,
  quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19,
};
const TENS: Array<[string, number]> = [
  ["venti", 20], ["trenta", 30], ["quaranta", 40], ["cinquanta", 50],
  ["sessanta", 60], ["settanta", 70], ["ottanta", 80], ["novanta", 90],
];

function below100(word: string): number | null {
  if (word === "") return 0;
  const unit = UNITS[word];
  if (unit !== undefined) return unit;
  for (const [tens, value] of TENS) {
    if (word === tens) return value;
    if (word.startsWith(tens)) {
      const rest = UNITS[word.slice(tens.length)];
      if (rest !== undefined && rest > 0 && rest < 10) return value + rest;
    }
    const stem = tens.slice(0, -1);
    if (word === `${stem}uno`) return value + 1;
    if (word === `${stem}otto`) return value + 8;
  }
  return null;
}

function below1000(word: string): number | null {
  const at = word.indexOf("cent");
  if (at === -1) return below100(word);
  const head = word.slice(0, at);
  const multiplier = head === "" ? 1 : UNITS[head];
  if (multiplier === undefined || multiplier < 1 || multiplier > 9) return null;
  const tail = word.slice(at + 4);
  let rest = below100(tail);
  if (rest === null && tail.startsWith("o")) rest = below100(tail.slice(1));
  if (rest === null) return null;
  return multiplier * 100 + rest;
}

/** Parses one Italian number word, for example "duecentomila" gives 200000. Null if it is not one. */
export function parseItalianNumberWord(input: string): number | null {
  const word = stripAccents(input.toLowerCase()).trim();
  if (word === "") return null;
  if (word === "mezzo") return null;
  if (word.startsWith("mille")) {
    const rest = below1000(word.slice(5));
    return rest === null ? null : 1000 + rest;
  }
  const at = word.indexOf("mila");
  if (at > 0) {
    const head = below1000(word.slice(0, at));
    const rest = below1000(word.slice(at + 4));
    if (head === null || head < 2 || rest === null) return null;
    return head * 1000 + rest;
  }
  return below1000(word);
}

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Parses "100.000", "1,5", "0.042" or "1.234,50" using Italian conventions. */
export function parseNumeric(raw: string): { value: number; decimals: number } | null {
  const text = raw.trim();
  if (/^\d{1,3}(?:[.  ]\d{3})+(?:,\d+)?$/.test(text) && !/^0\./.test(text)) {
    const [whole = "", fraction = ""] = text.split(",");
    const value = Number(`${whole.replace(/[.  ]/g, "")}.${fraction || "0"}`);
    return Number.isFinite(value) ? { value, decimals: fraction.length } : null;
  }
  if (/^\d+[.,]\d+$/.test(text)) {
    const normalized = text.replace(",", ".");
    const value = Number(normalized);
    const fraction = normalized.split(".")[1] ?? "";
    return Number.isFinite(value) ? { value, decimals: fraction.length } : null;
  }
  if (/^\d+$/.test(text)) return { value: Number(text), decimals: 0 };
  return null;
}

const SCALE: Array<[RegExp, number]> = [
  [/^k$/i, 1_000],
  [/^mila$/i, 1_000],
  [/^milion[ei]$/i, 1_000_000],
  [/^miliard[oi]$/i, 1_000_000_000],
];

function scaleOf(word: string | undefined): number {
  if (!word) return 1;
  for (const [pattern, factor] of SCALE) if (pattern.test(word)) return factor;
  return 1;
}

/** Text that holds digits but states no figure: age-band labels, list markers, URLs. */
function maskNonFigures(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^\s*\d+[.)]\s+/gm, " ")
    .replace(/\b(?:over|ultra)[\s-]?(?:50|65|75)(?:enni)?\b/gi, " ")
    .replace(/\b50\s?[-–]\s?64(?:\s?anni)?\b/g, " ");
}

const DIGIT_TOKEN =
  /(?<![\p{L}\p{N}])(\d{1,3}(?:[.  ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?:\s?(k(?!m)|mila|milion[ei]|miliard[oi]))?(?:km|mq|ha|m)?(?![\p{L}\p{N}])(\s?%|\s?per\s?cento)?/giu;

const SEI_AS_NUMBER = /^\s+(?:zone|zona|interventi|circoscrizioni|quartieri|progetti|persone|mesi|anni|mila|milioni)\b/i;

/** Every figure in the text, written in digits or as an Italian number word. */
export function extractNumbers(input: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  const masked = maskNonFigures(input);

  const withoutDigits = masked.replace(DIGIT_TOKEN, (match, numeric: string, scale: string | undefined, pct: string | undefined) => {
    const parsed = parseNumeric(numeric);
    if (parsed) {
      const factor = scaleOf(scale);
      tokens.push({
        raw: match.trim(),
        value: parsed.value * factor,
        decimals: factor === 1 ? parsed.decimals : 0,
        percent: Boolean(pct),
      });
    }
    return " ".repeat(match.length);
  });

  const wordPattern = /\p{L}+/gu;
  let found: RegExpExecArray | null;
  let previous = "";
  while ((found = wordPattern.exec(withoutDigits)) !== null) {
    const original = found[0];
    const word = stripAccents(original.toLowerCase());
    const after = withoutDigits.slice(found.index + original.length);
    const isPerCento = previous === "per" && word === "cento";
    previous = word;
    if (isPerCento) continue;
    if (word === "un" || word === "uno" || word === "una") {
      // An article, unless it heads a scale: "un milione" is a figure.
      const scale = /^\s+(milione|miliardo)\b/i.exec(after)?.[1];
      if (scale) {
        tokens.push({ raw: `${original} ${scale}`, value: scaleOf(scale), decimals: 0, percent: false });
      }
      continue;
    }
    if (word === "mezzo" && /^\s+milione\b/i.test(after)) {
      tokens.push({ raw: "mezzo milione", value: 500_000, decimals: 0, percent: false });
      continue;
    }
    if (word === "sei" && !SEI_AS_NUMBER.test(after)) continue;
    const value = parseItalianNumberWord(word);
    if (value === null) continue;
    const scaleMatch = /^\s+(milion[ei]|miliard[oi])\b/i.exec(after);
    const factor = scaleOf(scaleMatch?.[1]);
    const percent = /^\s*(?:%|per\s?cento)/i.test(after);
    tokens.push({ raw: original, value: value * factor, decimals: 0, percent });
  }
  return tokens;
}

/** All figures in a JSON payload: numeric values, numbers inside strings, digits inside keys. */
export function collectAllowedNumbers(payload: unknown): number[] {
  const out = new Set<number>();
  const walk = (node: unknown): void => {
    if (typeof node === "number") {
      if (Number.isFinite(node)) out.add(node);
      return;
    }
    if (typeof node === "string") {
      for (const token of extractNumbers(node)) out.add(token.value);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        for (const digits of key.match(/\d+/g) ?? []) out.add(Number(digits));
        walk(value);
      }
    }
  };
  walk(payload);
  return [...out];
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function isSupported(token: NumberToken, allowed: number[]): boolean {
  for (const candidate of allowed) {
    if (nearlyEqual(token.value, candidate)) return true;
    if (nearlyEqual(token.value, roundTo(candidate, token.decimals))) return true;
    if (token.percent && candidate >= 0 && candidate <= 1) {
      const asPercent = candidate * 100;
      if (nearlyEqual(token.value, asPercent)) return true;
      if (nearlyEqual(token.value, roundTo(asPercent, token.decimals))) return true;
    }
  }
  return false;
}

/** The figures in the text that the payload does not support. Empty means the text passes. */
export function findUnsupportedNumbers(text: string, payload: unknown): string[] {
  const allowed = collectAllowedNumbers(payload);
  return extractNumbers(text)
    .filter((token) => !isSupported(token, allowed))
    .map((token) => token.raw);
}
