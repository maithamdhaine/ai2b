## Planner v2 and robustness (planner_ref.py, 13:35)
- **v1 planner diagnosis:** at every budget from €50k to €500k, it funds only "sicurezza digitale". "hub_prossimita" never fits below €171k.
- **v2 planner** (intensity weights, max 40% of budget per type, partial last item), default weights, €200k: 5 pairs. 2 sicurezza digitale, 2 accesso salute, 1 visite domiciliari. €200,000 spent, 2,520 people reached (a planning assumption).
- **Funded zones at €200k:** Nuova Fiat (60), Lingotto (61), Sanatorio-Gerbido (62), Basse di Stura (67), Barriera di Stura (68, circ 6).
- **Local robustness** (1,000 weightings close to the default): Lingotto 99%, Basse di Stura 92%, Sanatorio-Gerbido 89%, Barriera di Stura 79%, Nuova Fiat 58%, Millefonti 39%.
- **Global robustness** (1,000 fully random weightings): no zone is above 43% (Borgata Aurora). The choice of priorities matters more than the data. Say this plainly.
- **Age-only baseline at €200k:** it funds zones 13, 51, 52, 62 and 75, with mean service_gap 53 and inclusion 21, and €0 to circ 6. The model plan reaches the same number of people with mean service_gap 83, inclusion 55, and €40k to circ 6.
