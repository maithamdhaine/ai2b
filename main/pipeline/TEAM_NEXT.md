# Integration handoff (Machine C, 4 Nov 2026, 15:05)

Code freeze 15:30, demo 16:00 on A's laptop. Paths are relative to the shared repo root.

## What is verified, and what is not

| | status |
|---|---|
| C data files and reference planner | **tested on C**: `python check_outputs.py` passes (94 ids, 858,874 people, valid WGS84, `mock: false`, test vectors) |
| A app (`machine-a/app`, commit `14d654f`) | read only, not run on C (no Node here). Still ships **mock** data (`public/data/meta.json` has `mock: true`) |
| A planner | A has its own formula (fit x depth x pair_need, zone cap 35%, type cap 40%, scaled last item). It is **not** C's planner v2, and it is not tested on real data |
| B server (`machine-b/server`, on `master` since `d024c89`) | code read, not run on C (no Node here). README: rules mode without a key, `/api/health` reports the mode. **There is no API key**, so the demo runs in rules mode. C's `zones.geojson` properties and `meta.json` sources match B's `src/contract.ts` types (checked by script; extra field `code` only) |
| end-to-end (real data + A planner + B memo) | **untested** |

## Integration table

| Machine | Verified deliverables | Next action | Dependency | Acceptance test |
|---|---|---|---|---|
| C | `machine-c/pipeline/out/` (4 contract files + `robustness.json`), `check_outputs.py` passing | support A and B, re-run on request | none | `python check_outputs.py` exits 0 |
| A | app code in `machine-a/app` (not run here) | **P0** copy C's 4 files into `machine-a/app/public/data/`, run tests, check the map | C files (ready) | banner "DATI DI PROVA" gone; 94 zones; zone 61 = "Lingotto - Ex Ippodromo", pop 25,059; `npx vitest run` green |
| A | `planner.ts` | **P0** confirm A's planner on real data: at least 3 types at €100k and €200k (`src/lib/acceptance.test.ts`) | step above | `acceptance.test.ts` passes on the real `zones.geojson` |
| B | server code in `machine-b/server` (not run on C) | **P0** start the server in rules mode on A's laptop; one `/api/memo` call with the real `meta.json` and the plan | A on real data | memo fits one page, lists the 15 sources, says "regole" mode |
| A | none | **P1** robustness / scenario comparison (below) | A's P0 done | badge or card shows only for the scenario it was computed for |

## Machine A, in order

**P0-1. Load real data** (PowerShell, from the repo root):
```bash
copy machine-c\pipeline\out\zones.geojson machine-a\app\public\data\
copy machine-c\pipeline\out\services.geojson machine-a\app\public\data\
copy machine-c\pipeline\out\funded.json machine-a\app\public\data\
copy machine-c\pipeline\out\meta.json machine-a\app\public\data\
cd machine-a\app; npm run check-data; npx vitest run; npm run dev
```
- Field notes: ids 93 = 09bis and 94 = 17bis (string `code`). Nullable fields: `over75_2030`, `stability_top10`, `nearest.pharmacy_m`.
  `stability_top10` and `alone_rate_circ` are 0-1. The scores are 0-100.
- Any test that hard-coded mock values will fail. Fix the test, not the data.

**P0-2. Planner on real data.** Keep A's planner. C's diagnosis of the old v1 rule (it picked only `sicurezza_digitale`) is the
reason for the 40% type cap that A already has. Do not try to match C's test vectors: they come from a different formula
(`planner_ref.py`, intensity weights instead of fit/depth). Use them only as a sanity check on totals and caps.

**P1. Robustness, only if P0 is green by 15:20.** `machine-c/pipeline/out/robustness.json` is **static**: it was computed with
C's reference planner, €200,000, default weights (isolation 0.4, service_gap 0.3, future_pressure 0.2, inclusion 0.1),
no filters, 1,000 weightings, seed 42. Its zones will not match A's plan exactly. Safe uses:
- a card "Quanto dipende dalle priorità?" quoting `local.zones` (Lingotto 99%, Basse di Stura 92%, Sanatorio-Gerbido 89%,
  Barriera di Stura 79%), labelled "modello di riferimento, €200.000, pesi predefiniti";
- the comparison card `baseline_age_only.stats` vs `model_default.stats` (service gap 53 vs 83, inclusion 21 vs 55,
  Circoscrizione 6 €0 vs €40.000, about 2.500 persone in both), with the same label.
Hide both, or show "non ricalcolato per questo scenario", once the budget, weights or filters change.
Never present them as robustness of the plan the user is looking at.

**Labels.** "indice di ritorno atteso (non SROI misurato)"; costs, reach and depth as "ipotesi del team"; people as
"persone raggiungibili (stima di piano)", not beneficiaries; `funded_eur = 0` as "nessun fondo PNRR sociale localizzato",
not "nessun fondo"; zone 1 with "affidabilità bassa" (assumed virtual-residence adjustment); RSA source as
"Regione Piemonte, via AperTO (2019)".

## Machine B

- **P0.** No API key exists: on A's laptop run `cd machine-b/server; npm install; npm start` with no `.env`.
  `curl http://localhost:8787/api/health` must say `"mode": "rules"`. Say "modalità regole" in the demo, never imply an LLM ran.
- **P0.** `npm test` and `npm run prompts -- --direct` on A's laptop, then one `/api/memo` call from the app with the real
  `meta.json` (15 sources) and A's real plan; check it fits one page and has no DATI DI PROVA line (`mock: false`).
- **P1.** After a weights change, the reply names the zones added and removed versus the previous plan, using only plan numbers.
- B reads no files: A sends `zones` (properties of `zones.geojson`) and `sources` (from `meta.json`) in the request body.

## Machine C

Done and published in `machine-c/pipeline/`. On request: re-run, add a field, or re-compute `robustness.json` for another
budget or weights (`planner_ref.py`, about 25 s).
