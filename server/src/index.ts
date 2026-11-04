import { readFileSync } from "node:fs";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { runAgent, warmUp } from "./agent.js";
import type {
  AgentResponse,
  HealthResponse,
  MemoRequest,
  MemoResponse,
  PlanItem,
  Source,
  ZoneProperties,
} from "./contract.js";
import { currentMode, ENV_PATH } from "./llm.js";
import { templateMemo, writeMemo } from "./memo.js";
import { normalizeMessages, normalizeState, validateActions } from "./validate.js";

function configuredPort(): number {
  let fromFile: string | undefined;
  try {
    fromFile = dotenv.parse(readFileSync(ENV_PATH)).PORT;
  } catch {
    fromFile = undefined;
  }
  const port = Number(fromFile ?? process.env.PORT ?? 8787);
  return Number.isInteger(port) && port > 0 ? port : 8787;
}

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
    res.json({ ok: true, mode: currentMode() });
  });

  app.post("/api/agent", async (req: Request, res: Response<AgentResponse>) => {
    const messages = normalizeMessages(req.body?.messages);
    const state = normalizeState(req.body?.state);
    const result = await runAgent(messages, state);
    // Final gate: whichever mode answered, only valid actions reach the browser.
    const { actions } = validateActions(result.actions);
    res.json({
      reply: result.reply,
      actions,
      needs_clarification: Boolean(result.needs_clarification),
      mode: result.mode,
    });
  });

  app.post("/api/memo", async (req: Request, res: Response<MemoResponse>) => {
    const state = normalizeState(req.body?.state);
    const bodyPlan: PlanItem[] = Array.isArray(req.body?.plan) ? req.body.plan : [];
    const request: MemoRequest = {
      state,
      plan: bodyPlan.length > 0 ? bodyPlan : state.plan,
      zones: Array.isArray(req.body?.zones) ? (req.body.zones as ZoneProperties[]) : [],
      sources: Array.isArray(req.body?.sources) ? (req.body.sources as Source[]) : [],
      mock: req.body?.mock === true,
    };
    try {
      res.json(await writeMemo(request));
    } catch (error) {
      console.warn(`[memo] unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
      res.json({ markdown: templateMemo(request), mode: "rules" });
    }
  });

  // The demo must keep answering: anything unexpected returns JSON, without internals.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.warn(`[server] ${error instanceof Error ? error.message : String(error)}`);
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
    res.status(status).json({ error: status < 500 ? "Richiesta non valida" : "Errore interno" });
  });

  return app;
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");

if (isMain) {
  const port = configuredPort();
  createApp().listen(port, () => {
    console.log(`Bussola AI server on http://localhost:${port} (mode: ${currentMode()})`);
    if (currentMode() === "rules") {
      console.log("No ANTHROPIC_API_KEY in server/.env: running in rules mode. Add it and LLM mode turns on without a restart.");
    }
    void warmUp();
  });
}
