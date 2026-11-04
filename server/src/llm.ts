/**
 * Anthropic client and truthful mode reporting, shared by agent and memo. Owned by the lead.
 * The key is read from server/.env on each use, so adding it does not need a restart.
 * The key is never logged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { DEFAULT_MODEL } from "./contract.js";
import type { Mode } from "./contract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = path.join(here, "..", ".env");

function envFile(): Record<string, string> {
  try {
    return dotenv.parse(readFileSync(ENV_PATH));
  } catch {
    return {};
  }
}

function readKey(): string {
  return (envFile().ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
}

export function modelName(): string {
  return (envFile().ANTHROPIC_MODEL ?? process.env.ANTHROPIC_MODEL ?? "").trim() || DEFAULT_MODEL;
}

let client: Anthropic | null = null;
let clientKey = "";
let authFailed = false;
let testClient: Anthropic | null | undefined;

/** The client, or null when no usable key is available. */
export function getClient(): Anthropic | null {
  if (testClient !== undefined) return testClient;
  const key = readKey();
  if (!key) {
    client = null;
    clientKey = "";
    return null;
  }
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 0 });
    clientKey = key;
    authFailed = false;
  }
  return authFailed ? null : client;
}

/** Tests only: pass a fake client, null for "no key", or undefined to restore normal behaviour. */
export function setClientForTests(fake: Anthropic | null | undefined): void {
  testClient = fake;
}

/** What /api/health reports. */
export function currentMode(): Mode {
  return getClient() ? "llm" : "rules";
}

/** Logs an LLM failure without secrets. A rejected key flips health to rules mode until it changes. */
export function noteLlmError(where: string, error: unknown): void {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    if (testClient === undefined) authFailed = true;
    console.warn(`[${where}] key rejected (${error.status}), using rules mode until the key changes`);
    return;
  }
  if (error instanceof Anthropic.APIError) {
    console.warn(`[${where}] API error ${error.status ?? "n/a"}: ${error.message}`);
    return;
  }
  console.warn(`[${where}] LLM failure: ${error instanceof Error ? error.message : String(error)}`);
}
