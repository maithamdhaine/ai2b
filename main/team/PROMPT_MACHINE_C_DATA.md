# You are Machine C: build the Bussola data pipeline

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
[time] Machine C | Workstream | Status: done, in progress or blocked
Works: ...
Not verified: ...
Needs from: ...
```

Never put API keys or passwords in the tracker.

## Parallel workstreams

**Lead setup:** create `pipeline/common.py` with download and parsing helpers, then produce the v1 `zones.geojson` yourself and send it to Machine A. Do not wait for the v1 file to launch the workstreams. Launch them as soon as the zone ids and Circoscrizione lookup are saved in `pipeline/work/zones_base.csv`.

| Workstream | Owns | Delivers |
| --- | --- | --- |
| Age estimates | `pipeline/age.py`, `pipeline/work/age.csv` | 2025 zone age estimates and 2030 cohort values |
| Services | `pipeline/services.py`, `pipeline/work/services.geojson`, `pipeline/work/access.csv` | Facility points, geocoding, distance values |
| Funding | `pipeline/funded.py`, `pipeline/work/funded.json`, `pipeline/work/funded_zone.csv` | Tagged social PNRR rows and zone totals |
| Households and inclusion | `pipeline/social.py`, `pipeline/work/social.csv` | Living-alone rate and foreign share |

The lead owns `pipeline/build.py`, which joins `pipeline/work/` into the four contract files, computes scores, validates, and writes `findings.md`.

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

Build a Python pipeline in `ai2b/pipeline` with pandas and geopandas. It downloads the open data, computes zone values, and writes the four contract files to `ai2b/pipeline/out/`. Keep raw downloads in `pipeline/raw/`, and make the pipeline re-runnable with one command.

Machine A is waiting for real data, so ship early. A real `zones.geojson` with correct boundaries and population comes first, even if some scores are still provisional. Send it within 30 minutes, then improve it.

## What we already checked this morning

- AperTO returns 403 to plain curl, so send a browser User-Agent. The CKAN API works: `https://aperto.comune.torino.it/api/3/action/package_show?id=<dataset-name>`, and `package_search?q=<words>`. Get resource URLs from there.
- CSVs we checked use semicolons, decimal commas and Latin-1 text. Inspect each file before parsing.
- Zone geometry: `http://geoportale.comune.torino.it/geodati/zip/zone_statistiche_csv.zip` has `ZONASTAT;DENOM;WKT_GEOM;COORD_X;COORD_Y`. `zone_statistiche_geo.zip` is the shapefile. The projection is Monte Mario Italy 1, likely EPSG:3003. Confirm the result lands on Turin after converting to WGS84.
- Age by zone stops at 2020. 2025 age data exists only for the 8 Circoscrizioni.
- "residenza_virtuale" is a separate column in the Circoscrizione files. Keep it out of zone rates. Its 2025 household file shows 3,176 men living alone. Do not claim what this group means unless a source confirms it.

| Dataset name on AperTO | Use | Notes |
| --- | --- | --- |
| `popolazione-per-sesso-e-zona-statistica-2025` | 2025 zone totals | `Num_zona_stat`, `Desc_zona_stat`, `femmine`, `maschi` |
| `popolazione-registrata-in-anagrafe-per-eta-annuale-e-zona-statistica-anno-2020` | Zone by age seed | Comma-separated and transposed: ages in rows, zones in columns. Blanks mean zero |
| `popolazione-residente-per-eta-e-circoscrizione-2025` | Age targets | `eta_annuale`, `circ_1` to `circ_8`, `residenza_virtuale` |
| `famiglie-per-tipologia-e-circoscrizione-2025` | Living alone | Rows "Femmine sole" and "Maschi soli". All ages |
| `indicatori-demografici-2025` | Validation | Published ageing index by Circoscrizione |
| `stranieri-residenti-per-zona-statistica-2025` | `foreign_share` | Inspect format first |
| `interventi-pnrr-pnc` | `funded.json` | Use the 30.06.26 xlsx. The 30.09.26 link returned 404. Columns include `INTERVENTO`, `TOTALE RISORSE`, `TAG AMBITO DI AZIONE (Giunta)`, `PERCENTUALE AVANZAMENTO INTERVENTO` |
| `residenze-sanitarie-assistenziali-private` | RSA points | 52 activity rows. Dedupe by `Codice_struttura`, then geocode `Indirizzo`. No bed counts seen. Filename suggests a regional source |
| `ospedali`, `biblioteche`, `mercati` | Service points | `ospedali_csv.zip` and `biblioteche_csv.zip` include `WKT_GEOM`, same projection family. Check `mercati` |
| `circoscrizioni` | Zone lookup | Use boundaries to assign each zone by largest overlap, because zones may not nest exactly |

Pharmacies: try `http://www.dati.salute.gov.it/sites/default/files/opendata/FRM_FARMA_5_20261104.csv`. Our script download was refused, so try a browser download. If it fails, set `pharmacy_m` to null and move on. The human on this machine is searching the Piemonte portal by hand, and will add useful files to `pipeline/raw/piemonte/`.

## Do this in order

1. **v1 file, within 30 minutes:** boundaries in WGS84, ids, names, `circ`, `pop_2025`, plus valid mock-free values for the rest using the simple rules below. Set `confidence` to `low`. Send it to Machine A.
2. **Age estimates:** use iterative proportional fitting. Start from the 2020 zone by age table, then fit to 2025 zone totals and 2025 Circoscrizione age totals. Output `over65_est`, `over75_est`, `adults_50_64_est`. If this fails, scale 2020 shares to 2025 totals, and label that in `meta.json`.
3. **Services:** build `services.geojson`. Geocode only what is needed, cache results, and respect Nominatim's limit of 1 request per second. Hand-fix bad addresses.
4. **Funding:** tag only social, care and elderly PNRR rows, by hand where needed, to a zone or Circoscrizione. Anything you cannot place stays citywide with null location. Never guess a location. Set `funded_share` by normalising funded euro per resident from 0 to 1.
5. **Scores**, each scaled 0 to 100 by percentile across non-small zones:
   - `isolation`: estimated over-75 share and `alone_rate_circ`.
   - `service_gap`: distance to the nearest health and care services, and few services within 800 m. The 800 m is our assumption.
   - `future_pressure`: move the 2020 age cohorts forward 10 years to estimate `over75_2030`, then compare it to today. This ignores migration and deaths, so use it as a relative signal only.
   - `inclusion`: `foreign_share`, for access and language need.
6. Set `small_zone` to true below 1,000 residents, and set `confidence` per zone.
7. **Validate:** recompute the 2025 ageing index by Circoscrizione from your estimates and compare it to the published file. Published values for Circoscrizioni 1 to 8: 267.6, 287, 279.7, 245.6, 220.6, 181.2, 237.5, 276.3. Zone totals must equal the source totals. Report any mismatch.
8. **Find the story:** test whether an age-only ranking misses zones that rank high once service gaps and existing funding are counted, especially in Circoscrizione 6. Write the result in `pipeline/findings.md`, with numbers, for the pitch. If it does not hold, say so plainly.

After 13:00, add `stability_top10`: run 1,000 random weightings, and record how often each zone stays in the top 10.

**Done by 13:00:** all four files validate against the contract and load on Machine A's map. `findings.md` has a first answer. Hand-check at least 5 zones against the source files.

## Task for the human on this machine, while Claude builds

Spend 15 minutes on https://www.dati.piemonte.it/#/home searching "Sanità", "Strutture sociosanitarie", "presidi", "RSA" and "medici". Save anything with Turin addresses or coordinates in `pipeline/raw/piemonte/`, and note each dataset's URL and year. The brief names this source, so we need to use it visibly.

## When you finish a step

Commit, and keep a short `pipeline/README.md` with the run command and every assumption. Send updated files to Machine A at each gate. Be honest about anything untested or estimated.
