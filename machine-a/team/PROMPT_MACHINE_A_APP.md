# You are Machine A: build the Bussola web app

Start now, and do not wait for the other machines. Ask a question only if you are truly blocked. Your first gate is **13:00**, and it is a hard deadline.

## Execution mode: lead plus parallel agents

Before pasting this prompt, the human sets Claude to its highest effort setting (Max).

You are the lead. Use parallel subagents, with the highest effort available, for the workstreams below.

1. Do the **lead setup** yourself first, and keep it under 10 minutes.
2. Launch all ready workstreams at the same time, in one message, in the background.
3. While they run, do the lead work: review results, integrate, and test.

**Rules for parallel work:**

- Each agent owns only the files listed for it. Only the lead edits shared files, and only the lead commits.
- Give each agent the shared contract and its exact file list, because agents start with no context.
- Agents must not change the contract. They report a mismatch to the lead.
- Each agent reports files changed, tests run, and anything unverified. Run the tests yourself before accepting the work.
- If an agent is stuck for 15 minutes, take over or cut scope. The 13:00 gate does not move.

## Team tracker

Shared tracking doc: https://docs.google.com/document/d/1Zas0rMZdcxJuhlP2wRnn4qvrUza-yb2PVEY3w31vcQU/edit?usp=sharing. Use the tab for this machine.

Log an update when you start, when each workstream finishes, at each gate, and whenever you are blocked. If you cannot write to the doc, print this block for the human to paste:

```
[time] Machine A | Workstream | Status: done, in progress or blocked
Works: ...
Not verified: ...
Needs from: ...
```

Never put API keys or passwords in the tracker.

## Parallel workstreams

**Lead setup:** scaffold the app, generate mock data, create `src/types.ts` from the contract, and create a shared store with `applyAction(action)` stubs.

| Workstream | Owns | Delivers |
| --- | --- | --- |
| Map | `src/components/map/` | Map, lenses, legend, zone panel |
| Planner logic | `src/lib/planner.ts`, `src/data/interventions.ts`, tests | Scoring, allocation, hand-checked tests |
| Planner UI | `src/components/planner/` | Profile, budget, sliders, filters, ranked results |
| AI and memo | `src/components/assistant/`, `src/components/memo/`, `src/lib/api.ts` | Command bar, action handling, memo view, offline template |

The lead owns `App.tsx`, `src/types.ts`, the store and global styles.

## Project context

We are a team of 3 at AI2B Games, a university AI competition, at the Torino stage. Each teammate uses Claude on a separate computer. All code goes in the folder `ai2b` on this computer's Desktop. Work there.

**Brief (Traccia 3, Welfare):** prototype a "Social Impact Planner" that identifies Turin neighbourhoods at higher risk of demographic isolation or service shortages, so third-sector organisations, banking foundations and institutions can direct funds where they generate the highest social return. Focus: social innovation, active ageing, workforce inclusion, urban vulnerabilities. Main data: AperTO, Comune di Torino open data. Supplementary data: Regione Piemonte open data.

**Competition rules:** any AI tool is allowed. The product must integrate an interactive, adaptive AI and visibly use the suggested datasets. We present live at 16:00 for about 5 minutes. The jury includes company representatives from Data Reply, DXC and Intesa Sanpaolo. Five criteria, 10 points each: fit with the theme, use of data, originality, functionality and AI integration, presentation.

**Our product, "Bussola":** a funding decision tool, not a vulnerability map. It answers: "Where should the next 100,000 euro go, and what is already funded there?" Flow:

1. **Map:** about 94 Turin statistical zones, with switchable lenses.
2. **Planner:** choose funder profile, budget and goal, then get a ranked portfolio of zone and intervention pairs, with people reached and cost per person.
3. **Funding memo:** a one-page Italian board brief with sources.

The AI operates the planner. A user types, for example, "ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR". The model returns tool actions, and the screen changes live.

**Non-negotiable rules:**

- The user interface and memo are in Italian.
- All numbers come from data or calculation. The LLM never invents or calculates figures.
- Show each figure's source and year, and mark estimates as estimates.
- Call the output "indice di ritorno atteso". Never call it a measured SROI.
- Intervention costs are team assumptions: label them and keep them editable.
- Treat foreign residents as an access and language need, never as a risk.

## Team and folders

| Machine | Role | Only writes in |
| --- | --- | --- |
| A | Web app, final demo laptop | `ai2b/app` |
| B | AI server. The pitch comes later | `ai2b/server` |
| C | Real data pipeline | `ai2b/pipeline`, and the final data files |

Never edit another machine's folder. Run `git init` in `ai2b` if needed and commit often. We integrate at 13:00 by copying folders together (shared repo if we create one, otherwise a zip). Machine A's laptop is the final demo laptop.

## Shared contract (do not change it without telling all three teammates)

Machine C delivers four files, which go in `ai2b/app/public/data/`. Until then, A and B use mock files with exactly this shape. Mock data must set `"mock": true` in `meta.json`, and the app must then show a visible "DATI DI PROVA" banner.

**`zones.geojson`**: GeoJSON FeatureCollection, WGS84, polygons. Properties per zone:

```json
{
  "id": 70, "name": "Pilonetto", "circ": 8,
  "pop_2025": 0, "over65_est": 0, "over75_est": 0, "adults_50_64_est": 0,
  "over75_2030": null, "alone_rate_circ": 0.0, "foreign_share": 0.0,
  "isolation": 0, "service_gap": 0, "future_pressure": 0, "inclusion": 0,
  "funded_eur": 0, "funded_projects": 0, "funded_share": 0.0,
  "nearest": {"health_m": 0, "care_m": 0, "pharmacy_m": null},
  "services_800m": 0, "stability_top10": null,
  "confidence": "estimated", "small_zone": false
}
```

- `isolation`, `service_gap`, `future_pressure`, `inclusion`: 0 to 100, higher means more need.
- `funded_share`: 0 to 1, higher means more already funded.
- `alone_rate_circ`: a Circoscrizione-level value copied to each zone.
- `confidence`: `official`, `estimated` or `low`.
- Nullable fields can be null, so handle that.

**`services.geojson`**: Points with `{id, name, type, address, source, year}`. `type` is one of `hospital`, `rsa`, `pharmacy`, `library`, `market`.

**`funded.json`**: array of `{id, title, programme, amount_eur, progress_pct, circ, zone_id, theme, source}`. `zone_id` and `circ` can be null, meaning citywide.

**`meta.json`**: `{"mock": false, "generated_at": "", "sources": [{"key": "", "label": "", "url": "", "year": 0, "level": ""}]}`

**Interventions** (owned by the app, in `app/src/data/interventions.ts`). Costs are team assumptions:

| id | Label | Target field | reach_share | fixed_eur | eur_per_person |
| --- | --- | --- | --- | --- | --- |
| `visite_domiciliari` | Visite e compagnia a domicilio | `over75_est` | 0.10 | 10000 | 350 |
| `hub_prossimita` | Hub di prossimità e cura | `over65_est` | 0.15 | 60000 | 80 |
| `accesso_salute` | Accesso digitale e sanitario | `over65_est` | 0.10 | 5000 | 120 |
| `sicurezza_digitale` | Sicurezza digitale e anti-truffa | `over65_est` | 0.20 | 3000 | 40 |
| `inserimento_lavoro` | Inserimento lavorativo over 50 e nuovi residenti | `adults_50_64_est` | 0.03 | 15000 | 900 |

**Scoring** (runs in the browser):

```
need          = weighted mean of the 4 zone scores, divided by 100
people        = zone[target] * reach_share
cost          = fixed_eur + people * eur_per_person
additionality = 1 - 0.8 * funded_share
return_index  = people * need * additionality / cost
```

Allocation is greedy by `return_index`: fund pairs until the budget runs out, use each pair once, cap any one zone at 35% of the budget, and exclude `small_zone` from ranking.

**Plan item:**

```json
{"zone_id": 70, "zone_name": "", "circ": 8, "intervention_id": "", "intervention_label": "",
 "budget_eur": 0, "people_reached": 0, "cost_per_person_eur": 0, "return_index": 0,
 "scores": {"isolation": 0, "service_gap": 0, "future_pressure": 0, "inclusion": 0, "funded_share": 0},
 "confidence": "estimated"}
```

**App state sent to the AI server:**

```json
{"profile": "foundation", "budget_eur": 100000,
 "weights": {"isolation": 0.4, "service_gap": 0.3, "future_pressure": 0.2, "inclusion": 0.1},
 "filters": {"circ": [], "exclude_funded": false, "min_over75": 0},
 "selected_zone_id": null, "plan": []}
```

`profile` is `foundation`, `third_sector` or `institution`.

**AI server API** (Machine B, port 8787; the app proxies `/api` to it):

- `GET /api/health` returns `{"ok": true, "mode": "llm"}`, where `mode` is `llm` or `rules`.
- `POST /api/agent` receives `{"messages": [{"role": "user", "content": ""}], "state": {}}` and returns `{"reply": "", "actions": [{"tool": "", "args": {}}], "needs_clarification": false, "mode": "llm"}`.
- `POST /api/memo` receives `{"state": {}, "plan": [], "zones": [], "sources": []}` and returns `{"markdown": "", "mode": "llm"}`.

**Actions the browser must apply, in order:**

| tool | args |
| --- | --- |
| `set_profile` | `{profile}` |
| `set_budget` | `{budget_eur}` |
| `set_weights` | `{isolation, service_gap, future_pressure, inclusion}`, each 0 to 1 |
| `filter_zones` | `{circ?: number[], exclude_funded?: boolean, min_over75?: number}` |
| `run_plan` | `{}` |
| `select_zone` | `{zone_id}` |
| `write_memo` | `{}` |

## Your job

Build the app in `ai2b/app` with Vite, React, TypeScript and Leaflet. No login, no database, no backend of your own. It must look like a credible tool for a foundation's programme officer: calm, clean, readable on a projector. Avoid generic AI-dashboard styling.

**Do this in order:**

1. Scaffold the app, and proxy `/api` to `http://localhost:8787`.
2. Write a script that generates mock `public/data/` files in the exact contract shape: about 94 grid polygons around Turin (roughly lat 45.01 to 45.14, lon 7.58 to 7.77), with `"mock": true`. Real files will replace them with no code changes.
3. Build the map, with lenses for Isolamento, Carenza servizi, Pressione futura, Inclusione and Già finanziato. Add a legend and a zone detail panel showing figures, confidence and data year.
4. Put the scoring and allocation in `src/lib/planner.ts` as pure functions, following the contract exactly. Add quick tests with a tiny hand-checked example.
5. Build the planner panel: profile, budget, four weight sliders, filters, and ranked results with people reached and cost per person. Changes must update instantly.
6. Add the AI command bar. It calls `/api/agent`, applies each returned action in order through one `applyAction(action)` function, and shows the reply. The planner must keep working if the server is off.
7. Add a memo view that calls `/api/memo` and renders the markdown. If the server is off, generate a plain template from the plan.

**Done by 13:00:** with mock data, a user can change the budget or weights and see the ranked plan and map update. `applyAction` works for every action when you test it with hard-coded JSON.

**After 13:00, in priority order:** real data integration, connection to Machine B's server, source labels, Italian copy polish, then the stretch feature: a drop-a-pin simulator, where placing a new hub on the map shows nearby older residents covered and the gap reduced.

## When you finish a step

Commit, and keep a short `app/README.md` with the run command. At 13:00, tell your teammate what works and what doesn't. Be honest about anything untested.
