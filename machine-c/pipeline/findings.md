# Findings (Machine C, Bussola)

Generated: 2026-11-04T15:00:02+01:00. Inputs complete: yes.

Question: does ranking zones by age alone (share of estimated over 75) miss zones that rank high once service gaps, future pressure, inclusion and existing PNRR funding are counted? Especially Circoscrizione 6.

Method: 84 zones with at least 1,000 residents. Age-only rank = estimated over-75 share. Full rank = need x additionality with the app's default weights (isolation 0.4, service_gap 0.3, future_pressure 0.2, inclusion 0.1) and additionality = 1 - 0.8 x funded_share. Same formula as the planner, without the intervention cost step. Over-75 counts are estimates (method: ipf).

## Answer
- Top 10 overlap: 2 of 10 zones are in both lists; 8 zones enter the full top 10 that the age-only top 10 misses.
- Circoscrizione 6 zones in the age-only top 10: 0; in the full top 10: 1.
- Best Circoscrizione 6 zone: Barriera di Stura - Istituto Rebaudengo (id 68), age-only rank 22, full rank 10 of 84.
- Top 20: Circoscrizione 6 has 1 zones age-only vs 4 in the full ranking.
- Estimated over-75 residents in the age-only top 10: 24,883; in the full top 10: 15,049. Zones of the full top 10 with under 3,000 residents: 4.
- Zones in the age-only top 10 that already receive placed PNRR social funding: 2; in the full top 10: 0.
- Robustness: across 1,000 random weightings, Circoscrizione 6 has 4 of the 12 most stable top-10 zones (Villaggio Snia, Villaretto, Regio Parco, Borgata Montebianco).
- Reading: the age-only list is dominated by older, well-served central and hill zones; the full ranking brings in peripheral zones with long distances to hospitals/RSA and higher inclusion need. Several of them are small (under 3,000 residents), so the planner's people-reached term will weigh them down in a real portfolio. The Circoscrizione 6 effect is modest, not dramatic: say so in the pitch.

## Zones the age-only ranking misses (in full top 10, not in age top 10)
| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | funded_share | rank solo età | rank completo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 67 | Basse di Stura - Nuovo Poligono | 5 | 2,258 | 17.0% | 57 | 98 | 74 | 82 | 0.00 | 14 | 1 |
| 73 | Strada di Soperga | 7 | 1,183 | 15.4% | 82 | 96 | 5 | 68 | 0.00 | 34 | 2 |
| 69 | Fioccardo - Alberoni | 8 | 2,030 | 15.6% | 78 | 91 | 49 | 11 | 0.00 | 27 | 3 |
| 72 | Borgata Sassi - Meisino | 7 | 3,058 | 13.9% | 59 | 94 | 77 | 9 | 0.00 | 53 | 4 |
| 83 | Santa Margherita | 8 | 1,814 | 16.8% | 86 | 72 | 36 | 30 | 0.00 | 18 | 6 |
| 60 | Nuova Fiat | 2 | 11,185 | 17.1% | 71 | 74 | 32 | 62 | 0.00 | 13 | 8 |
| 58 | Millefonti - Nuova Barriera di Nizza | 8 | 12,797 | 15.2% | 66 | 67 | 46 | 73 | 0.00 | 37 | 9 |
| 68 | Barriera di Stura - Istituto Rebaudengo | 6 | 8,814 | 16.4% | 54 | 89 | 34 | 64 | 0.00 | 22 | 10 |

## Zones that drop out once services and funding count (age top 10, not full top 10)
| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | funded_share | rank solo età | rank completo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 75 | Villa della Regina - Val Salice | 8 | 1,610 | 25.4% | 95 | 55 | 1 | 46 | 0.00 | 1 | 15 |
| 52 | Parco Francesco Ruffini - Borgata Lesna | 3 | 12,058 | 20.1% | 90 | 59 | 7 | 12 | 0.00 | 2 | 21 |
| 51 | Pozzo Strada | 3 | 16,714 | 19.1% | 88 | 42 | 12 | 22 | 0.00 | 4 | 30 |
| 13 | Borgo Po - Parco Michelotti | 8 | 5,689 | 18.8% | 92 | 20 | 10 | 7 | 0.00 | 5 | 53 |
| 27 | Ospedale Mauriziano | 1 | 6,060 | 18.2% | 99 | 14 | 9 | 5 | 0.00 | 6 | 50 |
| 55 | Ospizio di Carità | 2 | 17,868 | 18.0% | 80 | 10 | 22 | 29 | 0.51 | 7 | 82 |
| 26 | Crocetta | 1 | 12,569 | 17.5% | 98 | 11 | 8 | 26 | 0.00 | 9 | 48 |
| 90 | Mirafiori - Città Giardino | 2 | 17,853 | 17.5% | 77 | 78 | 68 | 43 | 0.31 | 10 | 27 |

## Full top 10
| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | funded_share | rank solo età | rank completo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 67 | Basse di Stura - Nuovo Poligono | 5 | 2,258 | 17.0% | 57 | 98 | 74 | 82 | 0.00 | 14 | 1 |
| 73 | Strada di Soperga | 7 | 1,183 | 15.4% | 82 | 96 | 5 | 68 | 0.00 | 34 | 2 |
| 69 | Fioccardo - Alberoni | 8 | 2,030 | 15.6% | 78 | 91 | 49 | 11 | 0.00 | 27 | 3 |
| 72 | Borgata Sassi - Meisino | 7 | 3,058 | 13.9% | 59 | 94 | 77 | 9 | 0.00 | 53 | 4 |
| 61 | Lingotto - Ex Ippodromo | 8 | 25,059 | 17.9% | 91 | 66 | 35 | 47 | 0.00 | 8 | 5 |
| 83 | Santa Margherita | 8 | 1,814 | 16.8% | 86 | 72 | 36 | 30 | 0.00 | 18 | 6 |
| 62 | Sanatorio - Gerbido | 2 | 19,005 | 19.2% | 84 | 90 | 17 | 20 | 0.00 | 3 | 7 |
| 60 | Nuova Fiat | 2 | 11,185 | 17.1% | 71 | 74 | 32 | 62 | 0.00 | 13 | 8 |
| 58 | Millefonti - Nuova Barriera di Nizza | 8 | 12,797 | 15.2% | 66 | 67 | 46 | 73 | 0.00 | 37 | 9 |
| 68 | Barriera di Stura - Istituto Rebaudengo | 6 | 8,814 | 16.4% | 54 | 89 | 34 | 64 | 0.00 | 22 | 10 |

## Age-only top 10
| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | funded_share | rank solo età | rank completo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 75 | Villa della Regina - Val Salice | 8 | 1,610 | 25.4% | 95 | 55 | 1 | 46 | 0.00 | 1 | 15 |
| 52 | Parco Francesco Ruffini - Borgata Lesna | 3 | 12,058 | 20.1% | 90 | 59 | 7 | 12 | 0.00 | 2 | 21 |
| 62 | Sanatorio - Gerbido | 2 | 19,005 | 19.2% | 84 | 90 | 17 | 20 | 0.00 | 3 | 7 |
| 51 | Pozzo Strada | 3 | 16,714 | 19.1% | 88 | 42 | 12 | 22 | 0.00 | 4 | 30 |
| 13 | Borgo Po - Parco Michelotti | 8 | 5,689 | 18.8% | 92 | 20 | 10 | 7 | 0.00 | 5 | 53 |
| 27 | Ospedale Mauriziano | 1 | 6,060 | 18.2% | 99 | 14 | 9 | 5 | 0.00 | 6 | 50 |
| 55 | Ospizio di Carità | 2 | 17,868 | 18.0% | 80 | 10 | 22 | 29 | 0.51 | 7 | 82 |
| 61 | Lingotto - Ex Ippodromo | 8 | 25,059 | 17.9% | 91 | 66 | 35 | 47 | 0.00 | 8 | 5 |
| 26 | Crocetta | 1 | 12,569 | 17.5% | 98 | 11 | 8 | 26 | 0.00 | 9 | 48 |
| 90 | Mirafiori - Città Giardino | 2 | 17,853 | 17.5% | 77 | 78 | 68 | 43 | 0.31 | 10 | 27 |

## Circoscrizione 6, all zones
| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | funded_share | rank solo età | rank completo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 68 | Barriera di Stura - Istituto Rebaudengo | 6 | 8,814 | 16.4% | 54 | 89 | 34 | 64 | 0.00 | 22 | 10 |
| 78 | Villaggio Snia | 6 | 3,773 | 12.1% | 9 | 94 | 97 | 92 | 0.00 | 73 | 12 |
| 76 | Villaretto | 6 | 1,036 | 4.2% | 2 | 99 | 98 | 76 | 0.00 | 84 | 19 |
| 77 | Falchera | 6 | 6,517 | 16.7% | 60 | 83 | 4 | 79 | 0.00 | 19 | 20 |
| 79 | Barca - Bertolla - Abbadia di Stura | 6 | 11,663 | 12.6% | 10 | 82 | 95 | 36 | 0.00 | 71 | 33 |
| 41 | Nuova Barriera di Milano | 6 | 13,979 | 16.3% | 48 | 53 | 40 | 77 | 0.00 | 23 | 36 |
| 40 | Regio Parco | 6 | 8,924 | 13.6% | 15 | 60 | 90 | 88 | 0.14 | 57 | 56 |
| 39 | Borgata Montebianco | 6 | 10,907 | 8.4% | 5 | 43 | 91 | 98 | 0.00 | 83 | 58 |
| 37 | Borgata Maddalene | 6 | 12,204 | 16.4% | 54 | 51 | 70 | 67 | 0.43 | 21 | 72 |
| 38 | Borgata Monterosa | 6 | 27,894 | 9.0% | 7 | 26 | 76 | 99 | 0.00 | 82 | 74 |

## Robustness: share of 1,000 random weightings where the zone stays in the top 10
| id | zona | circ | stability_top10 |
|---|---|---|---|
| 67 | Basse di Stura - Nuovo Poligono | 5 | 0.90 |
| 78 | Villaggio Snia | 6 | 0.74 |
| 76 | Villaretto | 6 | 0.64 |
| 46 | Nuova Barriera di Lanzo | 5 | 0.49 |
| 89 | Ex Aeroporto di Mirafiori | 2 | 0.47 |
| 90 | Mirafiori - Città Giardino | 2 | 0.47 |
| 73 | Strada di Soperga | 7 | 0.47 |
| 40 | Regio Parco | 6 | 0.43 |
| 24 | Borgata Aurora | 7 | 0.37 |
| 39 | Borgata Montebianco | 6 | 0.32 |
| 72 | Borgata Sassi - Meisino | 7 | 0.32 |
| 61 | Lingotto - Ex Ippodromo | 8 | 0.32 |

## Caveats
- Over-75 and 50-64 counts are estimates; future_pressure ignores deaths and migration (relative signal only).
- alone_rate_circ is a Circoscrizione value copied to every zone, so it does not separate zones inside a circ.
- Distances use the zone's representative point; 800 m radius is a team assumption.
- funded_share counts only social, care and elderly PNRR/PNC rows that could be placed; citywide rows are not allocated.
- The output is an 'indice di ritorno atteso', not a measured SROI.

## Planner v2 and robustness (planner_ref.py, 13:35)
- **v1 planner diagnosis:** at every budget from €50k to €500k, it funds only "sicurezza digitale". "hub_prossimita" never fits below €171k.
- **v2 planner** (intensity weights, max 40% of budget per type, partial last item), default weights, €200k: 5 pairs. 2 sicurezza digitale, 2 accesso salute, 1 visite domiciliari. €200,000 spent, 2,520 people reached (a planning assumption).
- **Funded zones at €200k:** Nuova Fiat (60), Lingotto (61), Sanatorio-Gerbido (62), Basse di Stura (67), Barriera di Stura (68, circ 6).
- **Local robustness** (1,000 weightings close to the default): Lingotto 99%, Basse di Stura 92%, Sanatorio-Gerbido 89%, Barriera di Stura 79%, Nuova Fiat 58%, Millefonti 39%.
- **Global robustness** (1,000 fully random weightings): no zone is above 43% (Borgata Aurora). The choice of priorities matters more than the data. Say this plainly.
- **Age-only baseline at €200k:** it funds zones 13, 51, 52, 62 and 75, with mean service_gap 53 and inclusion 21, and €0 to circ 6. The model plan reaches the same number of people with mean service_gap 83, inclusion 55, and €40k to circ 6.
