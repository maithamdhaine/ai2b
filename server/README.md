# Bussola AI server (Machine B)

Turns Italian language into planner actions and writes the funding memo from supplied facts.
The browser owns all maths. Port 8787. The app proxies `/api` to it.

## Run

```
cd server
npm install
npm run dev
```

`npm start` runs it without file watching, which is what to use on stage.

## API key

Put `ANTHROPIC_API_KEY=...` in `server/.env`. The file is git-ignored, and the key must never go in chat or the tracker.
The key is read on each request, so adding it does not need a restart.
Without a key, or with a rejected key, the server stays in rules mode. `GET /api/health` always reports the real mode.

## Endpoints

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/health` | none | `{"ok": true, "mode": "llm" or "rules"}` |
| `POST /api/agent` | `{"messages": [{"role": "user", "content": ""}], "state": {}}` | `{"reply": "", "actions": [{"tool": "", "args": {}}], "needs_clarification": false, "mode": ""}` |
| `POST /api/memo` | `{"state": {}, "plan": [], "zones": [], "sources": []}` | `{"markdown": "", "mode": ""}` |

`POST /api/memo` also accepts an optional `"mock": true`, which makes the memo open with a DATI DI PROVA line.
Send only the zones in the plan if you can. The server filters to them anyway before checking numbers.

Actions must be applied in the order given. See `SAMPLES.md` for real responses.

## Check it

```
npm test                       # all unit tests, no key needed
npm run typecheck
npm run prompts -- --direct    # the 10 demo prompts through rules mode, no server needed
npm run prompts                # the same prompts through the running server, in its current mode
```

curl, from the `server` folder:

```
curl http://localhost:8787/api/health
curl -X POST http://localhost:8787/api/agent -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"ho 200k per gli over 75 soli\"}],\"state\":{}}"
curl -X POST http://localhost:8787/api/memo -H "Content-Type: application/json" -d @samples/memo-request.json
```

## How it stays honest

- Every action from either mode passes `src/validate.ts`. Bad actions are dropped and values are clamped.
- In LLM mode, any failure, a timeout over 8 seconds or invalid output falls back to rules mode, and `mode` says so.
- Every number in an LLM memo must appear in the payload, otherwise the deterministic template is returned with `mode: "rules"`. Replies get the same number check.

## Files

| File | Purpose |
| --- | --- |
| `src/contract.ts` | Shared contract types |
| `src/validate.ts` | Validates and clamps actions, normalises input |
| `src/numbers.ts` | Number extraction and the number check |
| `src/profiles.ts` | Funder profiles and goal weight presets |
| `src/llm.ts` | Anthropic client, key handling, truthful mode |
| `src/rules.ts` | Deterministic Italian parser, the demo fallback |
| `src/agent.ts`, `src/prompts.ts` | LLM mode with tool use |
| `src/memo.ts` | Memo generation, checks, template fallback |
| `test-prompts.json`, `scripts/run-prompts.ts` | The 10 demo prompts and their runner |
