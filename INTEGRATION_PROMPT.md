# Integrate Bussola for the 16:00 live demo

You are the integration lead on the final demo laptop. Your job is to join three finished workstreams into one working app. Build no new features. Start now, and ask only if you are truly blocked.

**Deadlines:** code freezes at **15:30**, and we present live at **16:00** for about 5 minutes. Check the clock first. If time is short, follow the priority order below and cut from the bottom.

## Repo

`https://github.com/maithamdhaine/ai2b` on branch `master`. This repo is **public**, so never commit keys or `.env` files.

| Folder | Owner | Contents |
| --- | --- | --- |
| `machine-a/` | Web app | `machine-a/app` (Vite, React, TypeScript, Leaflet), and `machine-a/team` with the original prompts |
| `machine-b/` | AI server | Node server on port 8787, likely in `machine-b/server` |
| `machine-c/` | Data | Python pipeline and four output files, likely in `machine-c/pipeline/out` |

Run `git pull` first. Then inspect the real folder layout, because B and C may be nested differently. If `machine-b/` or `machine-c/` holds only `.gitkeep`, stop and tell the human which upload is missing. Meanwhile, do any work that doesn't depend on it.

Read `machine-a/team/PROMPT_MACHINE_A_APP.md` for the shared contract and rules, then `machine-a/app/src/types.ts` and `machine-a/app/src/store.ts`.

## Product in one line

Bussola is a funding decision tool for Turin: "Where should the next 100,000 euro go, and what is already funded there?" The flow is map, planner, then funding memo, and an AI command bar operates the planner.

## Do this in order

1. **Baseline.** Run `npm install`, `npx tsc --noEmit` and `npx vitest run` in `machine-a/app`. Note anything already failing.
2. **Real data.** Copy `zones.geojson`, `services.geojson`, `funded.json` and `meta.json` from Machine C's output into `machine-a/app/public/data/`, replacing the mock files. Validate before running the app:
   - `meta.json` has `"mock": false`, and sources are filled in.
   - `zones.geojson` has about 94 zones in WGS84, and they land on Turin. Every contract field exists.
   - `isolation`, `service_gap`, `future_pressure`, `inclusion` are 0 to 100. `funded_share`, `stability_top10` and `alone_rate_circ` are 0 to 1.
   - Each zone's `funded_eur` matches the sum of its projects in `funded.json`.
   - Read `findings.md`, and report the confirmed finding for the pitch.
3. **AI server.** Install and start Machine B's server on port 8787. Check `GET /api/health`. The human must put the API key in that server's local `.env`. If there is no key, confirm rules mode works, and tell the human.
4. **Connect.** Confirm the Vite proxy sends `/api` to `http://localhost:8787`. Run the app with `npm run dev`, and fix contract mismatches at the seam with the smallest possible change. If you must change the contract, say so.
5. **Test the full demo path in a real browser:**
   - The real Turin map loads, with no "DATI DI PROVA" banner.
   - Type: "ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR". Budget, weights and filters change, and the plan updates.
   - The plan contains more than one intervention type, and its rankings read correctly in order.
   - Selecting a plan row opens the zone on the map.
   - Type a follow-up change, and check that the plan updates again.
   - Generate the memo, and check that its numbers match the planner.
   - Stop the server, and confirm that the planner and template memo still work.
   - Check the app in both English and Italian, and fix missing strings in the language we'll present in.
6. **Verify numbers.** Hand-check 5 zones and the top 3 plan rows against the source files. Confirm 2025 age values are labelled as estimates, and that intervention costs, `fit`, `depth` and profile weights are labelled as team assumptions.
7. **Save.** Commit the integrated app to `master` and push. Check that no `.env`, key or `node_modules` is staged.

## Priority if time runs out

1. Real data on the map, and the planner working.
2. Memo working.
3. AI command bar working, in rules mode if necessary.
4. Number checks and language polish.
5. Anything else. Leave it out.

After 15:30, fix only demo-breaking bugs. Leave the app running on this laptop for rehearsal.

## Rules

- All numbers come from data or calculation. The LLM never invents them.
- Mark estimates. Say "indice di ritorno atteso", never SROI.
- Treat foreign residents as an access and language need, never as a risk.
- Don't redesign the interface.

## Report at the end

Tell the human exactly: what works, what you tested in the browser, what failed or was cut, whether the AI is in LLM or rules mode, the run commands for the demo, and the confirmed finding for the pitch.
