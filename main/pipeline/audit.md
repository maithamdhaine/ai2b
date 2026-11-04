# Audit (Machine C), 4 Nov 2026, 13:35

## Verified on this machine
| item | status | evidence |
|---|---|---|
| 94 zones, WGS84, inside Turin bbox | OK | `zones.py`, bounds 7.578-7.773 E, 45.007-45.140 N |
| pop_2025 total 858,874 = source minus residenza virtuale (4,375) | OK | assert in `zones.py` |
| ids 93 = 09bis, 94 = 17bis, original code in `code` | OK | `work/zones_base.csv` |
| circ by largest overlap; 12 zones straddle two (min 57% in zone 49) | OK, noted | `circ_overlap` column |
| Ages by IPF, converged (max margin error 0.41 people) | OK | `work/age_circ_check.csv` |
| Ageing index matches published | **not independent**: fitted target. The 2020 seed gives 9-39 points lower, so only "consistent", not "validated" | same file |
| Zone 1 seed minus 3,932 inferred virtual residents | assumption, confidence = low | `age.py` VIRTUAL_FIX |
| Foreign residents 140,805 (zones) + 2,366 virtual = second file | OK, independent check | `social.py` |
| 399 service points, all inside zone union | OK | `services.py` |
| 35 social PNRR/PNC rows, €83.1M, 8 placed by house-number geocoding | OK | `work/funded_tags.csv` |
| Contract validation of the 4 files | OK | `work/validation.txt` |
| 7 zones hand-checked against source lines | OK | README log |

## Data issues that could mislead the jury
1. **funded_eur = 0 means "no social PNRR row placed here"**, not "no services or funding". 27 rows (€33M) are citywide, and Case/Ospedali di Comunità (ASL) are absent. Say "fondi PNRR sociali localizzati".
2. **service_gap ranks hill zones high** (73 Strada di Soperga, 69 Fioccardo): they are low density and far from hospitals. Distance is real, but these zones are not deprived. Show people reached next to the score.
3. **alone_rate_circ has only 8 values** (Circoscrizione level). It cannot separate zones inside one circ.
4. **future_pressure** = 65+ in 2020 / 75+ in 2025, with no deaths or migration: a relative signal only.
5. **Hospitals are 2016 data, RSA 2019.** Year shown in `meta.json`.
6. **Percentile scores** exaggerate tiny differences in the middle of the distribution. Do not read a 3-point gap as meaningful.

## Planner math (runs in the app; diagnosed with `planner_ref.py`)
- **P0: the v1 rule funds only `sicurezza_digitale`** at 50k, 100k, 200k and 500k. Cost per person €40 vs €350 means it always wins on people/cost.
- **`hub_prossimita` can never be chosen** below €171k (min cost €61k > 35% cap).
- €100k gives only 5 small pairs; budget unspent €1.5k. Acceptable.
- `people_reached` = target x reach_share: a **planning assumption**, not a measured estimate.
- additionality = 1 - 0.8 x funded_share uses incomplete placement: zones next to citywide projects look unfunded.
- Fix v2 (in `planner_ref.py`, test vectors in `work/plan_test_vectors.json`):
  intensity weight per intervention, max 40% of budget per intervention type, scaled-down last pair.
  At €200k: 2 sicurezza + 2 accesso + 1 visite, €200,000 spent, 2,520 people.

## Integration status
See `TEAM_NEXT.md` (single source, updated 15:05). A ships its own planner (fit/depth), not C's v2.
