# Innovation: what makes Bussola different

## What already exists (verified sources)
- Vulnerability indices and maps are common: CDC SVI, Area Deprivation Index, many city apps
  ([CDC SVI](https://drought.gov/data-maps-tools/cdc-social-vulnerability-index), [PDX map app](https://github.com/BPSTechServices/pdx_vulnerability_map_app)).
- Need vs grant overlays exist for philanthropy: Philadelphia's COVID grantmaking atlas maps tracts where need outpaces grants
  ([Urban Spatial / Philanthropy Network](https://urbanspatial.github.io/COVIDPlanning)).
- Turin itself is already mapped: ISTAT presented sub-municipal social vulnerability indicators for Turin in July 2025
  ([ISTAT workshop](https://www.istat.it/wp-content/uploads/2025/06/Workshop_Torino_02luglio2025_Ferrara.pdf)), and
  Centro Einaudi's Rota report built a socio-economic hardship index by area
  ([Rota 2017](https://iris.polito.it/retrieve/handle/11583/2725871/233803/Torino%202017_cap.%2013%20Sist.Welfare.pdf)).
- Robust portfolio decision analysis is an established method for public funding under disagreement:
  keep alternatives that stay in good portfolios across many beliefs ([Baker, Bosetti, Salo, EJOR 2020](https://econpapers.repec.org/RePEc:eee:ejores:v:284:y:2020:i:3:p:1107-1120)).

**Conclusion:** a coloured map with a ranking and a chatbot is easy to replicate, and the jury will see several.
What we found nowhere for Turin: a **portfolio** answer (zones x interventions x euro) that states **how robust it is to the funder's own priorities**.

## Options
| | originality | value | data use | AI depth | effort | risk | demo |
|---|---|---|---|---|---|---|---|
| A refine map + planner | low | medium | high | medium | low | low | good |
| **B pivot: "Prova di robustezza" on the existing planner** | **high** | **high** | high | **high** | **low-medium** | **low** | **strong** |
| C new concept (e.g. service-desert routing) | medium | medium | medium | low | high | high | weak |

## Decision: Option B, "Bussola: il portafoglio che regge"
Signature moment: the jury member challenges the plan, and the AI answers with numbers that survive the challenge.
- **Badge per funded zone:** "solido" (funded in at least 70% of nearby weightings), "da discutere" (20-70%), "fragile" (under 20%),
  from `out/robustness.json` -> `local.zones`. At default weights: Lingotto 99%, Basse di Stura 92%,
  Sanatorio-Gerbido 89%, Barriera di Stura 79% are solid; Nuova Fiat 58% and Millefonti 39% are debatable.
- **Honest headline:** with *any* priorities (global test), no zone is funded in more than 43% of scenarios:
  *the funder's values decide more than the data*, and Bussola makes that visible instead of hiding it.
- **Baseline comparison:** the age-only plan funds hill and central zones (mean service_gap 53, inclusion 21). The model plan
  reaches the same number of people (2,520 vs 2,518) in zones with much worse service access (83) and higher inclusion need (55),
  and puts €40k into Circoscrizione 6 versus €0.
- **AI role:** the user's challenge ("e se contasse di più l'isolamento?") becomes set_weights + run_plan; the reply names
  what stayed, what left and why, using only plan numbers.
