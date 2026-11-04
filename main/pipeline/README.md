# Bussola data pipeline (Machine C)

Builds the real data files for the Bussola app (Traccia 3 Welfare, Torino) from open data.
Status and next actions per machine: [`TEAM_NEXT.md`](TEAM_NEXT.md). Data audit: [`audit.md`](audit.md).
Pitch story: [`findings.md`](findings.md). Product decision: [`innovation.md`](innovation.md).

## Install and run (tested on Windows, Python 3.12.10)

```bash
pip install -r requirements.txt
python run_all.py          # zones, age, social, services, funded, build, planner_ref
python check_outputs.py    # checks the published outputs, exit 1 on failure
```

- Each step can also run alone (`python build.py`, `python planner_ref.py`).
- `run_all.py` downloads the source files into `raw/` on first run. `raw/` is not published, except
  `raw/funded/nominatim_cache.json`. Downloads need internet access. The AperTO API needs a browser User-Agent, which `common.py` sends.
- Nominatim is called at most once per second. The answers are cached in `work/geocode_cache.json` (services) and
  `raw/funded/nominatim_cache.json` (PNRR sites). Both caches hold only addresses of public facilities and are published,
  so a rebuild does not hit Nominatim again. Geocoding © OpenStreetMap contributors, ODbL.
- A fully offline rebuild from the published repo has **not** been tested, because the source downloads are needed.
  From the existing `work/` files, `python build.py && python planner_ref.py && python check_outputs.py` runs offline.
  This was tested 4 Nov 2026 15:00 and all checks passed.

## Outputs (`out/`)

| file | what | for |
|---|---|---|
| `zones.geojson` | 94 statistical zones, WGS84 polygons, contract properties | A, B |
| `services.geojson` | 399 points: 31 hospital, 30 rsa, 276 pharmacy, 20 library, 42 market | A |
| `funded.json` | 35 social/care PNRR-PNC rows, €83.1M. 8 are placed in a zone (€50.2M), the rest are city-level | A, B |
| `meta.json` | `mock: false`, 15 sources (label, url, year), methods and assumptions | A, B |
| `robustness.json` | optional: robustness of C's reference plan (see TEAM_NEXT) | A, B |

Also published: `work/*.csv` (intermediate tables), `work/validation.txt`, `work/plan_test_vectors.json`,
`work/address_fixes.csv` (manual address fixes for geocoding).

## Sources (all in `meta.json` with URL and year)

| data | year | origin |
|---|---|---|
| zone and Circoscrizione boundaries | 2025 | Comune di Torino, Geoportale |
| population by zone and sex | 2025 | AperTO |
| age by Circoscrizione / by zone | 2025 / 2020 | AperTO. Zone ages for 2025 are **estimates** (IPF) |
| households by type (living alone) | 2025 | AperTO, Circoscrizione level only |
| foreign residents by zone | 2025 | AperTO |
| ageing index (validation) | 2025 | AperTO |
| hospitals, libraries, markets | 2016, 2017, 2016 | Comune di Torino, Geoportale |
| RSA private | 2019 | AperTO. CKAN metadata: author and maintainer Regione Piemonte, licence CC-BY, org Comune di Torino |
| pharmacies | 2026 | Ministero della Salute open data |
| PNRR/PNC interventions | update 30.06.2026 | Comune di Torino, AperTO |

The Piemonte regional portal was not used (team decision). The only regional-origin data is the RSA list, and only
that claim is backed by the CKAN metadata.

## Method and limitations

- Zone ids keep their number. `09bis` -> 93 and `17bis` -> 94, with the original code in property `code`.
- `residenza virtuale` (code 0, 4,375 people) is excluded, so the zone total is 858,874.
- A zone straddling two Circoscrizioni gets the one with the largest overlap. 12 zones straddle; the lowest overlap is 57%, in zone 49.
- 2025 zone ages: IPF of the 2020 zone ages onto the 2025 Circoscrizione margins. The ageing index then matches the
  published values by construction, so this is a consistency check, not independent validation.
- **Zone 1 (Municipio):** the 2020 seed is reduced by 3,932 inferred virtual residents. The source does not document this,
  so it is our assumption and the zone's `confidence` is `low`.
- Scores are 0-100 percentiles against zones with at least 1,000 residents. `small_zone` = population under 1,000 (10 zones).
  Small differences in the middle of the distribution mean little.
- `alone_rate_circ` has only 8 values (Circoscrizione level).
- `over75_2030` = residents 65+ in 2020, with no deaths or migration: a relative signal only.
- `foreign_share` feeds `inclusion` as an access and language need, never as a risk.
- **`funded_eur = 0` means no selected social PNRR/PNC row could be placed in that zone.** It is not proof that the zone has no funding:
  27 rows (€33M) are city-level, and Case/Ospedali di Comunità (ASL) are not in the Comune's file.
- `people_reached` in any plan is planned reach (target x reach share, a team assumption), not measured beneficiaries.
- Intervention costs, reach shares and intensity/depth are team assumptions. The output is an
  "indice di ritorno atteso", not a measured SROI.
- `stability_top10` = share of 1,000 Dirichlet(1,1,1,1) weightings (seed 42) where the zone is in the top 10 by need.

## Scripts

| script | writes |
|---|---|
| `common.py` | helpers: download, CKAN, Italian CSV reading, rate limiter |
| `zones.py` | `work/zones_base.*`: ids, names, circ, pop_2025 (asserts 94 zones, 858,874) |
| `age.py` | `work/age.csv`, `work/age_circ_check.csv` |
| `social.py` | `work/social.csv`, `work/social_circ.csv` |
| `services.py` | `work/services.geojson`, `work/access.csv` |
| `funded.py` | `work/funded.json`, `work/funded_zone.csv`, `work/funded_tags.csv` |
| `build.py` | `out/*` (4 contract files), scores, `work/validation.txt`, `findings.md` |
| `planner_ref.py` | `work/plan_test_vectors.json`, `out/robustness.json` (reference planner, Python) |
| `check_outputs.py` | checks on `out/*` and the test vectors |
