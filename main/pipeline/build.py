"""Lead: join pipeline/work/ into the four contract files in pipeline/out/, compute scores, validate.

Runs with whatever work files exist. Missing workstream files fall back to simple, labelled rules
and lower the confidence. Never invents values: a fallback is either a stated calculation or null/0
with confidence "low".

Outputs: out/zones.geojson, out/services.geojson, out/funded.json, out/meta.json, work/validation.txt
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geopandas as gpd
import numpy as np
import pandas as pd

from common import RAW, WORK, OUT, read_csv_it, in_turin

SCORES = ["isolation", "service_gap", "future_pressure", "inclusion"]
SMALL_POP = 1000
RNG_SEED = 42
N_WEIGHTINGS = 1000

SOURCES = {
    "zone_geo": dict(label="Zone statistiche (confini), Comune di Torino, Geoportale",
                     url="http://geoportale.comune.torino.it/geodati/zip/zone_statistiche_csv.zip", year=2025, level="zona"),
    "circ_geo": dict(label="Circoscrizioni (confini), Comune di Torino, Geoportale",
                     url="http://geoportale.comune.torino.it/geodati/zip/circoscrizioni_csv.zip", year=2025, level="circoscrizione"),
    "pop_zona_2025": dict(label="Popolazione per sesso e zona statistica 2025, AperTO",
                          url="https://aperto.comune.torino.it/dataset/popolazione-per-sesso-e-zona-statistica-2025", year=2025, level="zona"),
    "eta_circ_2025": dict(label="Popolazione residente per età e circoscrizione 2025, AperTO",
                          url="https://aperto.comune.torino.it/dataset/popolazione-residente-per-eta-e-circoscrizione-2025", year=2025, level="circoscrizione"),
    "eta_zona_2020": dict(label="Popolazione registrata in anagrafe per età annuale e zona statistica 2020, AperTO",
                          url="https://aperto.comune.torino.it/dataset/popolazione-registrata-in-anagrafe-per-eta-annuale-e-zona-statistica-anno-2020", year=2020, level="zona"),
    "famiglie_circ_2025": dict(label="Famiglie per tipologia e circoscrizione 2025, AperTO",
                               url="https://aperto.comune.torino.it/dataset/famiglie-per-tipologia-e-circoscrizione-2025", year=2025, level="circoscrizione"),
    "stranieri_zona_2025": dict(label="Stranieri residenti per zona statistica 2025, AperTO",
                                url="https://aperto.comune.torino.it/dataset/stranieri-residenti-per-zona-statistica-2025", year=2025, level="zona"),
    "indicatori_demo_2025": dict(label="Indicatori demografici 2025 (indice di vecchiaia, validazione), AperTO",
                                 url="https://aperto.comune.torino.it/dataset/indicatori-demografici-2025", year=2025, level="circoscrizione"),
    "aperto_ospedali": dict(label="Ospedali, Comune di Torino, AperTO/Geoportale", url="http://geoportale.comune.torino.it/geodati/zip/ospedali_csv.zip", year=2016, level="punto"),
    "aperto_rsa": dict(label="Residenze sanitarie assistenziali private (fonte file: Regione Piemonte), AperTO", url="https://risorse.comune.torino.it/opendata/salute/regpie_residente_sanitarie_assistenziali_private_comuneTO.csv", year=2019, level="punto"),
    "aperto_biblioteche": dict(label="Biblioteche, Comune di Torino, AperTO/Geoportale", url="http://geoportale.comune.torino.it/geodati/zip/biblioteche_csv.zip", year=2017, level="punto"),
    "aperto_mercati": dict(label="Mercati, Comune di Torino, AperTO/Geoportale", url="http://geoportale.comune.torino.it/geodati/zip/mercati_csv.zip", year=2016, level="punto"),
    "minsalute_farmacie": dict(label="Farmacie, Ministero della Salute (indirizzi geocodificati con OSM)", url="https://www.dati.salute.gov.it/sites/default/files/opendata/FRM_FARMA_5_20261104.csv", year=2026, level="punto"),
    "osm_nominatim": dict(label="Geocodifica indirizzi: OpenStreetMap Nominatim (© OpenStreetMap contributors, ODbL)",
                          url="https://nominatim.openstreetmap.org", year=2026, level="punto"),
    "pnrr_pnc": dict(label="Interventi PNRR e PNC, Comune di Torino (aggiornamento 30.06.2026), AperTO. Esclusi: Case e Ospedali di Comunità (ASL, non presenti nel file); 27 interventi sociali senza localizzazione restano a livello città",
                     url="https://risorse.comune.torino.it/opendata/pnrr/8_Riepilogo_interventi_PNRR_e_PNC_per_Sito_30.06.26_-_open_data.xlsx", year=2026, level="città"),
}


def load_csv(name):
    p = WORK / name
    return pd.read_csv(p) if p.exists() else None


def pct_rank(values: pd.Series, ref_mask: pd.Series) -> pd.Series:
    """0..100 percentile of each value against the reference (non-small) distribution. NaN stays NaN."""
    ref = np.sort(values[ref_mask].dropna().to_numpy())
    n = len(ref)
    if n == 0:
        return pd.Series(np.nan, index=values.index)
    lo = np.searchsorted(ref, values.to_numpy(), side="left")
    hi = np.searchsorted(ref, values.to_numpy(), side="right")
    out = 100.0 * (lo + 0.5 * (hi - lo)) / n
    out = np.where(values.isna(), np.nan, out)
    return pd.Series(out, index=values.index)


def combine(parts: list[tuple[pd.Series, float]], ref_mask) -> pd.Series:
    """Weighted mean of available percentile components, then re-scaled 0..100 by percentile."""
    num = sum(s.fillna(0) * w for s, w in parts)
    den = sum(s.notna() * w for s, w in parts)
    raw = num / den.replace(0, np.nan)
    return pct_rank(raw, ref_mask)


def main():
    log = []
    say = lambda s: (print(s), log.append(s))
    used = {"zone_geo", "circ_geo", "pop_zona_2025"}
    methods = {}

    z = gpd.read_file(WORK / "zones_base.geojson")
    z["id"] = z["id"].astype(int)
    z = z.set_index("id", drop=False).sort_index()
    pop = z["pop_2025"].astype(float)
    z["small_zone"] = z["pop_2025"] < SMALL_POP
    ref = ~z["small_zone"]

    # ---------- ages ----------
    age = load_csv("age.csv")
    if age is not None:
        age = age.set_index("id")
        for c in ["over65_est", "over75_est", "adults_50_64_est", "under15_est", "over75_2030"]:
            z[c] = age[c].reindex(z.index) if c in age else np.nan
        methods["age"] = str(age["method"].iloc[0]) if "method" in age else "ipf"
        used |= {"eta_zona_2020", "eta_circ_2025"}
        age_ok = True
    else:
        # Fallback: apply each Circoscrizione's 2025 age shares to zone totals (stated calculation).
        cf = read_csv_it(RAW / "lead" / "popolazione-residente-per-eta-e-circoscrizione-2025__9707")
        cf["eta"] = pd.to_numeric(cf["eta_annuale"].astype(str).str.extract(r"(\d+)")[0])
        shares = {}
        for k in range(1, 9):
            col = cf[f"circ_{k}"].astype(float)
            tot = col.sum()
            shares[k] = dict(
                over65=col[cf.eta >= 65].sum() / tot, over75=col[cf.eta >= 75].sum() / tot,
                a5064=col[(cf.eta >= 50) & (cf.eta <= 64)].sum() / tot, u15=col[cf.eta <= 14].sum() / tot)
        s = z["circ"].map(shares)
        z["over65_est"] = (pop * s.map(lambda d: d["over65"])).round()
        z["over75_est"] = (pop * s.map(lambda d: d["over75"])).round()
        z["adults_50_64_est"] = (pop * s.map(lambda d: d["a5064"])).round()
        z["under15_est"] = (pop * s.map(lambda d: d["u15"])).round()
        z["over75_2030"] = np.nan
        methods["age"] = "circ_2025_shares_applied_to_zone_totals (provisional v1)"
        used |= {"eta_circ_2025"}
        age_ok = False

    # ---------- social ----------
    soc = load_csv("social.csv")
    if soc is not None:
        soc = soc.set_index("id")
        z["alone_rate_circ"] = soc["alone_rate_circ"].reindex(z.index)
        z["foreign_share"] = soc["foreign_share"].reindex(z.index)
        used |= {"famiglie_circ_2025", "stranieri_zona_2025"}
    else:
        z["alone_rate_circ"] = np.nan
        z["foreign_share"] = np.nan

    # ---------- services ----------
    acc = load_csv("access.csv")
    if acc is not None:
        acc = acc.set_index("id")
        for c in ["health_m", "care_m", "pharmacy_m", "services_800m"]:
            z[c] = acc[c].reindex(z.index) if c in acc else np.nan
    else:
        for c in ["health_m", "care_m", "pharmacy_m", "services_800m"]:
            z[c] = np.nan

    # ---------- funding ----------
    fz = load_csv("funded_zone.csv")
    if fz is not None:
        fz = fz.set_index("id")
        z["funded_eur"] = fz["funded_eur"].reindex(z.index).fillna(0)
        z["funded_projects"] = fz["funded_projects"].reindex(z.index).fillna(0).astype(int)
        used |= {"pnrr_pnc", "osm_nominatim"}
    else:
        z["funded_eur"] = 0.0
        z["funded_projects"] = 0
    per_res = z["funded_eur"] / pop.replace(0, np.nan)
    rmax = per_res[ref].max()
    z["funded_eur_per_res"] = per_res
    z["funded_share"] = (per_res / rmax).clip(0, 1).fillna(0) if rmax and rmax > 0 else 0.0

    # ---------- scores ----------
    over75_share = z["over75_est"] / pop.replace(0, np.nan)
    z["over75_share"] = over75_share
    z["isolation"] = combine([(pct_rank(over75_share, ref), 0.6), (pct_rank(z["alone_rate_circ"], ref), 0.4)], ref)
    z["service_gap"] = combine([
        (pct_rank(z["health_m"], ref), 1.0), (pct_rank(z["care_m"], ref), 1.0),
        (pct_rank(z["pharmacy_m"], ref), 1.0), (pct_rank(-z["services_800m"], ref), 1.0)], ref)
    growth = z["over75_2030"] / z["over75_est"].replace(0, np.nan)
    z["over75_growth"] = growth
    z["future_pressure"] = pct_rank(growth, ref)
    z["inclusion"] = pct_rank(z["foreign_share"], ref)
    for s in SCORES:
        missing = z[s].isna().all()
        if missing:
            say(f"WARNING: score {s} has no input yet -> set to 0 for all zones (provisional)")
        z[s] = z[s].fillna(0).round().astype(int).clip(0, 100)

    # ---------- confidence ----------
    conf = pd.Series("estimated", index=z.index)
    if not age_ok or soc is None or acc is None or fz is None:
        conf[:] = "low"
    conf[z["small_zone"]] = "low"
    if "circ_overlap" in z:
        conf[z["circ_overlap"] < 0.75] = "low"
    if age is not None and "seed_pop_2020" in age:
        seed = age["seed_pop_2020"].reindex(z.index)
        change = (pop - seed).abs() / seed.replace(0, np.nan)
        conf[change > 0.25] = "low"
    if age is not None and "seed_note" in age:
        noted = age["seed_note"].reindex(z.index).notna()
        conf[noted] = "low"  # zone 1: 2020 seed adjusted for inferred virtual residents (not documented in source)
    z["confidence"] = conf

    # ---------- stability_top10 ----------
    rng = np.random.default_rng(RNG_SEED)
    W = rng.dirichlet(np.ones(4), size=N_WEIGHTINGS)
    S = z.loc[ref, SCORES].to_numpy(float)
    need = S @ W.T  # zones x weightings
    order = np.argsort(-need, axis=0)[:10]
    counts = np.zeros(S.shape[0])
    for j in range(N_WEIGHTINGS):
        counts[order[:, j]] += 1
    z["stability_top10"] = np.nan
    z.loc[ref, "stability_top10"] = np.round(counts / N_WEIGHTINGS, 3)

    # ---------- write zones.geojson ----------
    def num(v, nd=None):
        if v is None or (isinstance(v, float) and np.isnan(v)) or pd.isna(v):
            return None
        return round(float(v), nd) if nd is not None else int(round(float(v)))

    feats = []
    for i, r in z.iterrows():
        props = {
            "id": int(r["id"]), "name": r["name"], "circ": int(r["circ"]),
            "pop_2025": int(r["pop_2025"]),
            "over65_est": num(r["over65_est"]) or 0, "over75_est": num(r["over75_est"]) or 0,
            "adults_50_64_est": num(r["adults_50_64_est"]) or 0,
            "over75_2030": num(r["over75_2030"]),
            "alone_rate_circ": num(r["alone_rate_circ"], 4) if pd.notna(r["alone_rate_circ"]) else 0.0,
            "foreign_share": num(r["foreign_share"], 4) if pd.notna(r["foreign_share"]) else 0.0,
            "isolation": int(r["isolation"]), "service_gap": int(r["service_gap"]),
            "future_pressure": int(r["future_pressure"]), "inclusion": int(r["inclusion"]),
            "funded_eur": num(r["funded_eur"], 2) or 0.0, "funded_projects": int(r["funded_projects"]),
            "funded_share": num(r["funded_share"], 4) or 0.0,
            "nearest": {"health_m": num(r["health_m"]), "care_m": num(r["care_m"]), "pharmacy_m": num(r["pharmacy_m"])},
            "services_800m": num(r["services_800m"]) or 0,
            "stability_top10": num(r["stability_top10"], 3),
            "confidence": r["confidence"], "small_zone": bool(r["small_zone"]),
            "code": str(r["code"]),
        }
        feats.append({"type": "Feature", "properties": props,
                      "geometry": json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]})
    gj = {"type": "FeatureCollection", "features": feats}
    (OUT / "zones.geojson").write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")

    # ---------- services.geojson & funded.json ----------
    sp = WORK / "services.geojson"
    if sp.exists():
        sv = json.loads(sp.read_text(encoding="utf-8"))
        srcs = {f["properties"].get("source") for f in sv["features"]}
    else:
        sv, srcs = {"type": "FeatureCollection", "features": []}, set()
    (OUT / "services.geojson").write_text(json.dumps(sv, ensure_ascii=False), encoding="utf-8")
    fp = WORK / "funded.json"
    funded = json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else []
    (OUT / "funded.json").write_text(json.dumps(funded, ensure_ascii=False, indent=1), encoding="utf-8")

    # extra sources reported by workstreams
    extra = WORK / "sources_extra.json"
    extra_src = json.loads(extra.read_text(encoding="utf-8")) if extra.exists() else {}
    src_all = {**SOURCES, **extra_src}
    used |= {s for s in srcs if s in src_all}
    if age_ok:
        used.add("indicatori_demo_2025")
    meta = {
        "mock": False,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sources": [{"key": k, **src_all[k]} for k in sorted(used) if k in src_all],
        "methods": {
            "age": methods.get("age"),
            "isolation": "percentile(0.6*pct(quota over75 stimata) + 0.4*pct(tasso persone sole circoscrizione))",
            "service_gap": "percentile(media pct: distanza ospedale, distanza RSA, distanza farmacia, -servizi entro 800 m)",
            "future_pressure": "percentile(over75_2030 / over75 2025); over75_2030 = residenti 65+ nel 2020, senza morti né migrazioni: solo segnale relativo",
            "inclusion": "percentile(quota residenti stranieri): bisogno di accesso e lingua",
            "funded_share": "euro sociali PNRR/PNC per residente, normalizzati 0-1 sul massimo (zone non piccole)",
            "percentile_reference": "zone con almeno 1.000 residenti",
            "services_radius_m": 800,
            "stability_top10": f"{N_WEIGHTINGS} pesi casuali Dirichlet(1,1,1,1), seed {RNG_SEED}: quota di volte nella top 10",
            "assumptions": ["Raggio 800 m: ipotesi del team", "Costi interventi: ipotesi del team (app)", "Zona 1 (Municipio): il seed 2020 è stato ridotto di 3.932 persone ritenute residenza virtuale (dedotto dal calo 2020-2025, non documentato nella fonte); confidenza bassa"],
        },
        "zone_id_notes": {"93": "codice 09bis", "94": "codice 17bis"},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---------- validation ----------
    errs = validate(gj, sv, funded, meta)
    say(f"zones: {len(feats)}  pop total: {int(z.pop_2025.sum())}  small zones: {int(z.small_zone.sum())}")
    say(f"confidence: {z.confidence.value_counts().to_dict()}")
    say(f"services: {len(sv['features'])}  funded rows: {len(funded)}")
    say("contract validation: " + ("OK" if not errs else f"{len(errs)} problems"))
    for e in errs[:30]:
        say("  - " + e)
    z.drop(columns="geometry").to_csv(WORK / "zones_built.csv", index=False)
    log += validation_extra(z)
    (WORK / "validation.txt").write_text("\n".join(log), encoding="utf-8")
    write_findings(z, ref, meta, complete=(age_ok and soc is not None and acc is not None and fz is not None))
    return errs


def validation_extra(z) -> list[str]:
    out = ["", "## Ageing index check by Circoscrizione (100 * over65 / under15)"]
    chk = WORK / "age_circ_check.csv"
    if chk.exists():
        out.append(pd.read_csv(chk).to_string(index=False))
    else:
        pub = [267.6, 287, 279.7, 245.6, 220.6, 181.2, 237.5, 276.3]
        g = z.groupby("circ")[["over65_est", "under15_est"]].sum()
        g["ageing_index_est"] = (100 * g.over65_est / g.under15_est).round(1)
        g["published"] = pub
        g["diff"] = (g.ageing_index_est - g.published).round(1)
        out.append(g.to_string())
    out.append("")
    out.append("## Totals")
    out.append(f"sum pop_2025 zones = {int(z.pop_2025.sum())} (source file minus residenza virtuale = 858874)")
    for c in ["over65_est", "over75_est", "adults_50_64_est"]:
        out.append(f"sum {c} = {int(z[c].sum())}")
    return out


def write_findings(z, ref, meta, complete: bool):
    """Does an age-only ranking miss zones that rank high once service gaps and funding are counted?"""
    d = z[ref].copy()
    w = {"isolation": 0.4, "service_gap": 0.3, "future_pressure": 0.2, "inclusion": 0.1}
    d["need"] = sum(d[k] * v for k, v in w.items()) / 100
    d["additionality"] = 1 - 0.8 * d["funded_share"]
    d["full_score"] = d["need"] * d["additionality"]
    d["age_rank"] = d["over75_share"].rank(ascending=False, method="first").astype(int)
    d["full_rank"] = d["full_score"].rank(ascending=False, method="first").astype(int)
    N = 10
    age_top = d[d.age_rank <= N].sort_values("age_rank")
    full_top = d[d.full_rank <= N].sort_values("full_rank")
    missed = full_top[full_top.age_rank > N]
    dropped = age_top[age_top.full_rank > N]
    c6 = d[d.circ == 6].sort_values("full_rank")

    def row(r):
        return (f"| {int(r.id)} | {r['name']} | {int(r.circ)} | {int(r.pop_2025):,} | {100*r.over75_share:.1f}% | "
                f"{int(r.isolation)} | {int(r.service_gap)} | {int(r.future_pressure)} | {int(r.inclusion)} | "
                f"{r.funded_share:.2f} | {int(r.age_rank)} | {int(r.full_rank)} |")

    hdr = ("| id | zona | circ | pop 2025 | over75 stimati | isolation | service_gap | future_pressure | inclusion | "
           "funded_share | rank solo età | rank completo |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
    L = ["# Findings (Machine C, Bussola)", "",
         f"Generated: {meta['generated_at']}. Inputs complete: {'yes' if complete else 'NO, provisional (some workstreams missing)'}.",
         "",
         "Question: does ranking zones by age alone (share of estimated over 75) miss zones that rank high "
         "once service gaps, future pressure, inclusion and existing PNRR funding are counted? Especially Circoscrizione 6.",
         "",
         f"Method: {len(d)} zones with at least 1,000 residents. Age-only rank = estimated over-75 share. Full rank = "
         "need x additionality with the app's default weights (isolation 0.4, service_gap 0.3, future_pressure 0.2, "
         "inclusion 0.1) and additionality = 1 - 0.8 x funded_share. Same formula as the planner, without the "
         f"intervention cost step. Over-75 counts are estimates (method: {meta['methods']['age']}).",
         "",
         "## Answer",
         f"- Top {N} overlap: {N - len(missed)} of {N} zones are in both lists; {len(missed)} zones enter the full top {N} "
         f"that the age-only top {N} misses.",
         f"- Circoscrizione 6 zones in the age-only top {N}: {int((age_top.circ == 6).sum())}; "
         f"in the full top {N}: {int((full_top.circ == 6).sum())}.",
         f"- Best Circoscrizione 6 zone: {c6.iloc[0]['name']} (id {int(c6.iloc[0].id)}), age-only rank "
         f"{int(c6.iloc[0].age_rank)}, full rank {int(c6.iloc[0].full_rank)} of {len(d)}." if len(c6) else "- no circ 6 zones",
         f"- Top 20: Circoscrizione 6 has {int((d[d.age_rank <= 20].circ == 6).sum())} zones age-only vs "
         f"{int((d[d.full_rank <= 20].circ == 6).sum())} in the full ranking.",
         f"- Estimated over-75 residents in the age-only top {N}: {int(age_top.over75_est.sum()):,}; in the full top {N}: "
         f"{int(full_top.over75_est.sum()):,}. Zones of the full top {N} with under 3,000 residents: "
         f"{int((full_top.pop_2025 < 3000).sum())}.",
         f"- Zones in the age-only top {N} that already receive placed PNRR social funding: "
         f"{int((age_top.funded_share > 0).sum())}; in the full top {N}: {int((full_top.funded_share > 0).sum())}.",
         (f"- Robustness: across 1,000 random weightings, Circoscrizione 6 has "
          f"{int((d.sort_values('stability_top10', ascending=False).head(12).circ == 6).sum())} of the 12 most stable "
          f"top-10 zones ({', '.join(d[d.circ == 6].sort_values('stability_top10', ascending=False).head(4).name)}).")
         if d["stability_top10"].notna().any() else "- Robustness: not computed",
         "- Reading: the age-only list is dominated by older, well-served central and hill zones; the full ranking "
         "brings in peripheral zones with long distances to hospitals/RSA and higher inclusion need. Several of them "
         "are small (under 3,000 residents), so the planner's people-reached term will weigh them down in a real "
         "portfolio. The Circoscrizione 6 effect is modest, not dramatic: say so in the pitch.",
         "",
         f"## Zones the age-only ranking misses (in full top {N}, not in age top {N})", hdr]
    L += [row(r) for _, r in missed.iterrows()] or ["| none |"]
    L += ["", f"## Zones that drop out once services and funding count (age top {N}, not full top {N})", hdr]
    L += [row(r) for _, r in dropped.iterrows()] or ["| none |"]
    L += ["", f"## Full top {N}", hdr] + [row(r) for _, r in full_top.iterrows()]
    L += ["", f"## Age-only top {N}", hdr] + [row(r) for _, r in age_top.iterrows()]
    L += ["", "## Circoscrizione 6, all zones", hdr] + [row(r) for _, r in c6.iterrows()]
    if d["stability_top10"].notna().any():
        st = d.sort_values("stability_top10", ascending=False).head(12)
        L += ["", "## Robustness: share of 1,000 random weightings where the zone stays in the top 10",
              "| id | zona | circ | stability_top10 |", "|---|---|---|---|"]
        L += [f"| {int(r.id)} | {r['name']} | {int(r.circ)} | {r.stability_top10:.2f} |" for _, r in st.iterrows()]
    L += ["", "## Caveats",
          "- Over-75 and 50-64 counts are estimates; future_pressure ignores deaths and migration (relative signal only).",
          "- alone_rate_circ is a Circoscrizione value copied to every zone, so it does not separate zones inside a circ.",
          "- Distances use the zone's representative point; 800 m radius is a team assumption.",
          "- funded_share counts only social, care and elderly PNRR/PNC rows that could be placed; citywide rows are not allocated.",
          "- The output is an 'indice di ritorno atteso', not a measured SROI."]
    extra = Path(__file__).resolve().parent / "findings_planner.md"
    if extra.exists():
        L += ["", extra.read_text(encoding="utf-8").rstrip()]
    (Path(__file__).resolve().parent / "findings.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def validate(gj, sv, funded, meta):
    errs = []
    req = {"id": int, "name": str, "circ": int, "pop_2025": int, "over65_est": int, "over75_est": int,
           "adults_50_64_est": int, "alone_rate_circ": float, "foreign_share": float, "isolation": int,
           "service_gap": int, "future_pressure": int, "inclusion": int, "funded_eur": (int, float),
           "funded_projects": int, "funded_share": (int, float), "services_800m": int,
           "confidence": str, "small_zone": bool}
    nullable = {"over75_2030", "stability_top10"}
    ids = set()
    for f in gj["features"]:
        p = f["properties"]
        for k, t in req.items():
            if k not in p:
                errs.append(f"zone {p.get('id')}: missing {k}")
            elif not isinstance(p[k], t if isinstance(t, tuple) else (t,) if t is not float else (int, float)):
                errs.append(f"zone {p.get('id')}: {k} has type {type(p[k]).__name__}")
        for k in nullable:
            if k not in p:
                errs.append(f"zone {p.get('id')}: missing {k}")
        if set(p.get("nearest", {})) != {"health_m", "care_m", "pharmacy_m"}:
            errs.append(f"zone {p.get('id')}: nearest keys")
        for s in SCORES:
            if not 0 <= p[s] <= 100:
                errs.append(f"zone {p['id']}: {s} out of range")
        if not 0 <= p["funded_share"] <= 1:
            errs.append(f"zone {p['id']}: funded_share out of range")
        if p["confidence"] not in ("official", "estimated", "low"):
            errs.append(f"zone {p['id']}: bad confidence")
        if f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
            errs.append(f"zone {p['id']}: geometry {f['geometry']['type']}")
        ids.add(p["id"])
    if len(ids) != len(gj["features"]):
        errs.append("duplicate zone ids")
    for f in sv["features"]:
        p = f["properties"]
        if set(p) < {"id", "name", "type", "address", "source", "year"}:
            errs.append(f"service {p.get('id')}: missing keys")
        if p.get("type") not in ("hospital", "rsa", "pharmacy", "library", "market"):
            errs.append(f"service {p.get('id')}: bad type {p.get('type')}")
        lon, lat = f["geometry"]["coordinates"][:2]
        if not in_turin(lon, lat):
            errs.append(f"service {p.get('id')}: outside Turin")
    fk = {"id", "title", "programme", "amount_eur", "progress_pct", "circ", "zone_id", "theme", "source"}
    for r in funded:
        if not fk <= set(r):
            errs.append(f"funded {r.get('id')}: missing {fk - set(r)}")
        if r.get("zone_id") is not None and r["zone_id"] not in ids:
            errs.append(f"funded {r.get('id')}: unknown zone_id {r['zone_id']}")
    for s in meta["sources"]:
        if set(s) < {"key", "label", "url", "year", "level"}:
            errs.append(f"meta source {s.get('key')}: missing keys")
    return errs


if __name__ == "__main__":
    errs = main()
    sys.exit(1 if errs else 0)
