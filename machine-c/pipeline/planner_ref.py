"""Reference planner v2 (Python twin of the app's browser planner) + robustness analysis.

Why: the v1 rule (greedy by people*need*additionality/cost, 35% zone cap) picks ONLY
"sicurezza_digitale" at every budget from 50k to 500k, and "hub_prossimita" can never fit.
v2 changes (all labelled team assumptions, editable in the app):
  1. intensity per intervention: depth of support per person reached (0-1).
     return_index = people * intensity * need * additionality / cost
  2. max 40% of the budget per intervention type (portfolio diversity).
  3. the last pair may be scaled down to fit the remaining room (fixed cost kept, fewer people),
     only if it still reaches at least 50% of its planned people.
  Zone cap 35% and small_zone exclusion are unchanged.

Writes:
  work/plan_test_vectors.json  expected plans for the app to match (A's acceptance test)
  out/robustness.json          share of 1,000 random weightings in which each zone / pair is funded,
                               plus an age-only baseline plan for comparison
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import OUT, WORK

INTERVENTIONS = [
    # id, label, target, reach_share, fixed_eur, eur_per_person, intensity (team assumption)
    ("visite_domiciliari", "Visite e compagnia a domicilio", "over75_est", 0.10, 10000, 350, 1.0),
    ("hub_prossimita", "Hub di prossimità e cura", "over65_est", 0.15, 60000, 80, 0.8),
    ("accesso_salute", "Accesso digitale e sanitario", "over65_est", 0.10, 5000, 120, 0.5),
    ("sicurezza_digitale", "Sicurezza digitale e anti-truffa", "over65_est", 0.20, 3000, 40, 0.25),
    ("inserimento_lavoro", "Inserimento lavorativo over 50 e nuovi residenti", "adults_50_64_est", 0.03, 15000, 900, 1.0),
]
SCORES = ["isolation", "service_gap", "future_pressure", "inclusion"]
DEFAULT_W = {"isolation": 0.4, "service_gap": 0.3, "future_pressure": 0.2, "inclusion": 0.1}
ZONE_CAP, TYPE_CAP, MIN_PARTIAL = 0.35, 0.40, 0.5


def load_zones():
    gj = json.loads((OUT / "zones.geojson").read_text(encoding="utf-8"))
    return [f["properties"] for f in gj["features"]]


def plan(zones, budget, weights=DEFAULT_W, exclude_funded=False, circ=None, min_over75=0,
         need_fn=None, use_additionality=True, intensity=True, type_cap=TYPE_CAP, partial=True):
    wsum = sum(weights.values()) or 1
    pairs = []
    for z in zones:
        if z["small_zone"] or (exclude_funded and z["funded_share"] > 0) or (circ and z["circ"] not in circ) \
                or z["over75_est"] < min_over75:
            continue
        need = need_fn(z) if need_fn else sum(z[k] * weights.get(k, 0) for k in SCORES) / wsum / 100
        add = 1 - 0.8 * z["funded_share"] if use_additionality else 1.0
        for iid, label, tgt, rs, fx, pp, it in INTERVENTIONS:
            people = z[tgt] * rs
            cost = fx + people * pp
            ri = people * (it if intensity else 1) * need * add / cost
            pairs.append(dict(z=z, iid=iid, label=label, people=people, cost=cost, fx=fx, pp=pp, ri=ri))
    pairs.sort(key=lambda x: (-x["ri"], x["z"]["id"], x["iid"]))
    left, zs, ts, out = budget, Counter(), Counter(), []
    for x in pairs:
        room = min(left, ZONE_CAP * budget - zs[x["z"]["id"]], type_cap * budget - ts[x["iid"]])
        if x["cost"] <= room:
            cost, people = x["cost"], x["people"]
        elif partial and room > x["fx"] and (room - x["fx"]) / x["pp"] >= MIN_PARTIAL * x["people"]:
            cost, people = room, (room - x["fx"]) / x["pp"]
        else:
            continue
        z = x["z"]
        out.append({
            "zone_id": z["id"], "zone_name": z["name"], "circ": z["circ"],
            "intervention_id": x["iid"], "intervention_label": x["label"],
            "budget_eur": round(cost), "people_reached": round(people),
            "cost_per_person_eur": round(cost / people) if people else None,
            "return_index": round(x["ri"] * 1e4, 3),  # x 1e4 for readability; relative only
            "scores": {**{k: z[k] for k in SCORES}, "funded_share": z["funded_share"]},
            "confidence": z["confidence"],
        })
        left -= cost
        zs[z["id"]] += cost
        ts[x["iid"]] += cost
        if left < 1:
            break
    return out


def summary(p):
    return {"items": len(p), "spent_eur": sum(i["budget_eur"] for i in p),
            "people_reached": sum(i["people_reached"] for i in p),
            "interventions": dict(Counter(i["intervention_id"] for i in p)),
            "zones": sorted({i["zone_id"] for i in p})}


def main():
    zones = load_zones()
    by_id = {z["id"]: z for z in zones}

    # --- diagnosis of v1 rule ---
    v1 = {b: summary(plan(zones, b, intensity=False, type_cap=1.0, partial=False)) for b in (50000, 100000, 200000, 500000)}

    # --- test vectors for the app ---
    cases = [
        ("default_100k", dict(budget=100000)),
        ("default_200k", dict(budget=200000)),
        ("anziani_soli_200k_no_pnrr", dict(budget=200000, weights={"isolation": 0.55, "service_gap": 0.225,
                                                                     "future_pressure": 0.162, "inclusion": 0.063},
                                            exclude_funded=True)),
        ("circ6_100k", dict(budget=100000, circ=[6])),
    ]
    vectors = {name: {"input": {k: v for k, v in kw.items()}, "plan": plan(zones, **kw)} for name, kw in cases}
    (WORK / "plan_test_vectors.json").write_text(json.dumps(
        {"planner": "v2", "rules": __doc__.split("Writes:")[0].strip(), "cases": vectors,
         "v1_diagnosis": v1}, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- robustness: 1,000 random weightings at 200k ---
    B, N = 200000, 1000
    rng = np.random.default_rng(42)
    W = rng.dirichlet(np.ones(4), size=N)
    zc, pc = Counter(), Counter()
    for w in W:
        p = plan(zones, B, weights=dict(zip(SCORES, w)))
        for zid in {i["zone_id"] for i in p}:
            zc[zid] += 1
        for i in p:
            pc[(i["zone_id"], i["intervention_id"])] += 1

    def cls(s):
        return "nucleo_robusto" if s >= 0.7 else "dipende_dalle_priorita" if s >= 0.2 else "raro"

    zrows = sorted(({"zone_id": k, "zone_name": by_id[k]["name"], "circ": by_id[k]["circ"],
                     "share_funded": round(v / N, 3), "class": cls(v / N)} for k, v in zc.items()),
                   key=lambda r: -r["share_funded"])
    prow = sorted(({"zone_id": k[0], "intervention_id": k[1], "share_funded": round(v / N, 3)}
                   for k, v in pc.items()), key=lambda r: -r["share_funded"])

    # --- local robustness: small perturbations around the default weights (Dirichlet, concentration 40) ---
    Wl = rng.dirichlet(40 * np.array([DEFAULT_W[k] for k in SCORES]), size=N)
    lc = Counter()
    for w in Wl:
        for zid in {i["zone_id"] for i in plan(zones, B, weights=dict(zip(SCORES, w)))}:
            lc[zid] += 1
    local = sorted(({"zone_id": k, "zone_name": by_id[k]["name"], "circ": by_id[k]["circ"],
                     "share_funded": round(v / N, 3), "class": cls(v / N)} for k, v in lc.items()),
                   key=lambda r: -r["share_funded"])

    # --- baseline: age-only ranking (over-75 share), no funding correction ---
    sh = np.array([z["over75_est"] / z["pop_2025"] for z in zones if not z["small_zone"]])

    def age_need(z):
        return float((sh < z["over75_est"] / z["pop_2025"]).mean())

    base = plan(zones, B, need_fn=age_need, use_additionality=False)
    model = plan(zones, B)

    def stats(p):
        s = summary(p)
        s["eur_to_zones_already_funded"] = sum(i["budget_eur"] for i in p if i["scores"]["funded_share"] > 0)
        s["mean_service_gap"] = round(float(np.mean([i["scores"]["service_gap"] for i in p])), 1)
        s["mean_inclusion"] = round(float(np.mean([i["scores"]["inclusion"] for i in p])), 1)
        s["circ6_eur"] = sum(i["budget_eur"] for i in p if i["circ"] == 6)
        return s

    rob = {
        "planner": "v2", "budget_eur": B, "n_weightings": N, "seed": 42,
        "method": "pesi casuali Dirichlet(1,1,1,1) sui 4 indicatori; quota di scenari in cui la zona riceve fondi",
        "classes": {"nucleo_robusto": ">= 70% degli scenari", "dipende_dalle_priorita": "20-70%", "raro": "< 20%"},
        "zones": zrows, "pairs": prow[:60],
        "local": {"method": "pesi vicini ai pesi predefiniti (Dirichlet, concentrazione 40, circa +-0.08)",
                  "weights": DEFAULT_W, "zones": local},
        "baseline_age_only": {"plan": base, "stats": stats(base)},
        "model_default": {"plan": model, "stats": stats(model)},
    }
    (OUT / "robustness.json").write_text(json.dumps(rob, ensure_ascii=False, indent=1), encoding="utf-8")

    print("v1 diagnosis:", json.dumps({b: v["interventions"] for b, v in v1.items()}))
    for n, v in vectors.items():
        print(n, summary(v["plan"]))
    print("robust core:", [(r["zone_name"], r["share_funded"]) for r in zrows if r["class"] == "nucleo_robusto"])
    print("depends:", len([r for r in zrows if r["class"] == "dipende_dalle_priorita"]), "zones")
    print("local:", [(r["zone_name"][:20], r["share_funded"]) for r in local[:10]])
    print("baseline age-only:", stats(base))
    print("model default:   ", stats(model))


if __name__ == "__main__":
    main()
