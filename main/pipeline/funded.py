"""Funding workstream: PNRR / PNC social, care and elderly interventions of the Comune di Torino.

Source: AperTO dataset "interventi-pnrr-pnc" (CKAN), resource "Interventi pnrr-pnc giugno 2026"
(xlsx, status at 30.06.2026). The newer "settembre 2026" resource (30.09.26) is listed in CKAN but
its file URL returned HTTP 404 (checked 2026-11-04). This script is PINNED to the 30.06.26 file:
the hand decisions below are keyed to that file's row counter ("it" column) and each one is
checked against a piece of the title, so a different file fails loudly instead of mis-tagging.

Decision order (recorded per row in work/funded_tags.csv):
  1. Mission/line columns: M1 (digital, culture), M2 (mobility, waste, energy, green), M4
     (schools, nurseries) are excluded. M5C2 investments 1.1 / 1.2 / 1.3 (social services,
     disability, extreme poverty) are kept, theme from the sub-investment line.
  2. By hand on titles: M5C2 2.x / 3.x (urban regeneration, PUI, PINQUA, sport) rows are kept
     only when the title names a social, care or public-housing function (table HAND below).
Location: zone only from a specific street address with house number, geocoded with Nominatim
(1 req/s, cached in raw/funded/) and point-in-polygon on work/zones_base.geojson. A row with several
sites is placed only if all sites fall in one zone (or, for circ, one Circoscrizione). Everything
else is citywide (zone_id = circ = null). No row names a Circoscrizione on its own.

Outputs (work/):
  funded.json      kept rows: {id, title, programme, amount_eur, progress_pct, circ, zone_id, theme, source}
  funded_tags.csv  all rows of the file: keep, theme, reason, zone_id, circ, location_evidence
  funded_zone.csv  per zone: direct_eur, circ_alloc_eur (CALCULATION: circ-level euro spread to the
                   circ's zones by pop_2025 share), funded_eur, funded_projects, citywide_eur_total
Run: python funded.py
"""
from __future__ import annotations

import json
import re
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import Point

from common import HEADERS, METRIC_CRS, RAW, WGS84, WORK, RateLimiter, ckan_resources, download, in_turin

DATASET = "interventi-pnrr-pnc"
PIN_TAG = "30.06.26"
NEWER_TAG = "30.09.26"
FALLBACK_URL = ("https://risorse.comune.torino.it/opendata/pnrr/"
                "8_Riepilogo_interventi_PNRR_e_PNC_per_Sito_30.06.26_-_open_data.xlsx")
SOURCE = "aperto_interventi_pnrr_pnc_2026-06-30"
SUB = "funded"
GEO_CACHE = RAW / SUB / "nominatim_cache.json"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
GEO_UA = "Bussola-AI2B-student-project/0.1"
NEAR_EDGE_M = 10.0  # if even the most interior agreeing hit is closer than this to the zone edge,
                    # the zone is not trusted (row goes to circ level if the circ is unambiguous)

FONDO = {"PNRR": "PNRR", "FNC": "PNC", "PNRR/FNC": "PNRR+PNC", "RISORSE NAZIONALI": "Risorse nazionali ex PNRR"}

# M5C2 investments 1.1-1.3: theme by sub-investment line.
LINE_THEME = {
    "1.1.1": ("inclusione sociale", "M5C2 1.1.1: support to parents, prevention of family/child vulnerability (PIPPI)"),
    "1.1.2": ("anziani", "M5C2 1.1.2: autonomy of non self-sufficient elderly people"),
    "1.1.3": ("anziani", "M5C2 1.1.3: home social services for assisted hospital discharge (mainly elderly)"),
    "1.1.4": ("altro sociale", "M5C2 1.1.4: strengthening social services, burn-out prevention for social workers"),
    "1.2": ("disabilità", "M5C2 1.2: autonomy paths for people with disabilities (housing, work)"),
    "1.3.1": ("abitare", "M5C2 1.3.1: extreme poverty, Housing First"),
    "1.3.2": ("inclusione sociale", "M5C2 1.3.2: extreme poverty, 'stazioni di posta' service centres"),
}

# Hand decisions for M5C2 2.x / 3.x and borderline rows, keyed by the file's "it" counter.
# (keep, theme, reason, title_check, addresses). addresses: street + number strings to geocode.
HAND = {
    59: (False, None, "M5C2 2.1 urban regeneration: title names only the area, no social/care function stated (borderline)",
         "EX VEGLIO", []),
    69: (True, "inclusione sociale", "PUI: building with social-assistance centres + youth centre (mixed, amount not split)",
         "socio assistenziali di strada delle Cacce 36", ["Strada delle Cacce 36"]),
    # Borderline exclusions carry their addresses, so flipping keep to True geocodes them automatically.
    70: (False, None, "PUI: renovation of two buildings, function not stated in title (borderline; "
                      "Comune works acts DD 2025 2842 / DD 7123 2025 exist, building use not verified)",
         "via Frejus 21 e via Bixio 56", ["Via Frejus 21", "Via Bixio 56"]),
    71: (False, None, "PUI: civic libraries + youth centres, mainly culture, no social-care function (borderline)",
         "Cesare Pavese", []),
    72: (False, None, "PUI: road/sidewalk works with barrier removal, infrastructure (borderline accessibility)",
         "area nord", []),
    73: (False, None, "PUI: road/sidewalk works with barrier removal, infrastructure (borderline accessibility)",
         "area sud", []),
    80: (True, "altro sociale", "PUI: building refit, 'parte sociale e parte biblioteca' (mixed, whole amount counted)",
         "Leoncavallo 17/27", ["Via Leoncavallo 17", "Via Leoncavallo 27", "Via Pacini 18"]),
    81: (True, "inclusione sociale", "PUI: Alma Mater building (Centro interculturale delle donne; function known, not written in title)",
         "Norberto Rosa 13", ["Via Norberto Rosa 13"]),
    82: (True, "abitare", "PUI: safety and accessibility of City housing units (social-housing status implied, not stated)",
         "unità abitative", []),
    83: (True, "abitare", "PUI: social reception house ('casa di accoglienza sociale')",
         "accoglienza sociale di via Foligno 10", ["Via Foligno 10"]),
    84: (True, "altro sociale", "PUI: ex-IRV complex refit 'per il potenziamento dei servizi sociali'",
         "Unione Sovietica 220", ["Corso Unione Sovietica 220"]),
    87: (False, None, "PUI: sports facility (impianto Massari) and land acquisition: sport excluded",
         "impianto Massari", []),
    95: (True, "inclusione sociale", "PUI: co-design with third sector, social actions for adolescents and youth",
         "terzo settore", []),
    96: (True, "inclusione sociale", "PUI: social accompaniment and citizen participation",
         "Accompagnamento sociale", []),
    97: (True, "abitare", "PINQUA: public residential housing (ERP)",
         "Piazza Repubblica 13", ["Piazza della Repubblica 13"]),
    102: (True, "abitare", "PINQUA: repair of City-owned housing units for re-allocation",
          "riassegnazione degli alloggi", []),
    103: (True, "abitare", "PINQUA (ATC): public residential housing (ERP)",
          "Corso Racconigi 25", ["Corso Racconigi 25"]),
    110: (True, "abitare", "PINQUA (ATC): public residential housing (ERP)",
          "Viale dei Mughetti 20", ["Viale dei Mughetti 20"]),
    111: (True, "abitare", "PINQUA (ATC, public housing agency): replacement of ex Poste building, lot 1 demolition (final ERP use not written in title)",
          "sede Poste", []),
    112: (False, None, "PINQUA (ATC): renovation of commercial premises, no social function stated (borderline)",
          "Casa Bottega", []),
    113: (True, "abitare", "PINQUA (ATC): renovation of vacant public housing units (ERP)",
          "alloggi di risulta", []),
    119: (False, None, "M5C2 3.1 'Sport e inclusione sociale': sports facility, sport excluded (borderline)",
          "Cittadella dello Sport", []),
    120: (False, None, "M5C2 3.1 'Sport e inclusione sociale': sports facility, sport excluded (borderline)",
          "Galoppatoio", []),
    128: (False, None, "PNC M2C3 'Sicuro, verde e sociale': energy/seismic renovation of ERP, energy mission excluded (borderline abitare)",
          "VIA AOSTA 37", ["Via Aosta 37"]),
    129: (False, None, "PNC M2C3 'Sicuro, verde e sociale': energy/seismic renovation of ERP, energy mission excluded (borderline abitare)",
          "VIA SANSOVINO 26", ["Via Sansovino 26"]),
    4: (False, None, "M1C1 digital: accessibility of digital public services (digital, not social-care)",
        "CITIZEN INCLUSION", []),
    11: (False, None, "M1C1 digital: digital facilitation network (borderline digital inclusion)",
         "FACILITAZIONE DIGITALE", []),
}

# Location notes for kept rows that mention a place but cannot be placed (all M5C2 1.x rows are citywide).
LOC_NOTE = {
    38: "names 'distretti Est' (social-service districts), not a Circoscrizione or address",
    39: "names 'distretti Ovest' (social-service districts), not a Circoscrizione or address",
    40: "project names 'Silver Housing Massaua' and 'Case Cimarosa': no address, two sites in one amount",
    41: "'Via Ravenna' (no house number) + 'Cocoon' + 'Roccavione Silver Housing': several sites in one amount",
    49: "'Roccavione Hub' + a project at Falchera (zone 77): two sites in one amount, not split",
    50: "project names 'Case Cimarosa' and 'Il Molino si fa casa': no address",
    56: "project name 'Fermata Cimarosa': the row gives no address",
    57: "'Social Case' + a project at Falchera (zone 77): two sites in one amount, not split",
    58: "five projects, one 'in Circoscrizione 3', others without site: amount not split",
    82: "three streets without house numbers (corso Lombardia, via Pianezza, corso Lecce-via Fabrizi) in one amount",
    95: "city-wide action, no site",
    96: "city-wide action, no site",
    102: "City housing units, no address",
    111: "'fabbricato sede Poste' without address; prefix VAL = PINQUA Vallette proposal (inferred from rows VAL 1/VAL 9), NOT applied",
    113: "vacant units without address; prefix VAL = PINQUA Vallette proposal (inferred), NOT applied",
}

MISSION_REASON = {
    1: "M1 digitalisation/culture: not social-care",
    2: "M2 green transition (mobility, waste, energy, green, soil): excluded",
    4: "M4 education (schools, nurseries): excluded",
}

EXCL_RULES = [  # for M5C2 2.x / 3.x rows not in HAND; first match wins
    (r"aree verdi|alberat", "public green: excluded"),
    (r"bibliotec|bibliobus", "culture (libraries): excluded"),
    (r"scuol|scolastic", "school buildings: excluded"),
    (r"sportiv|piscin|stadio|palestra", "sport facilities: excluded"),
    (r"mercat", "markets (commerce): excluded"),
    (r"ciclabil|mobilit|zona 20|pedonalit", "mobility / public space: excluded"),
    (r"verd|alberat|parco", "public green: excluded"),
    (r"suolo|piazzale", "public space / ground works: excluded"),
]


def load_xlsx() -> tuple[pd.DataFrame, str]:
    url = FALLBACK_URL
    try:
        res = ckan_resources(DATASET)
        pinned = [r for r in res if PIN_TAG in (r["url"] or "")]
        newer = [r for r in res if NEWER_TAG in (r["url"] or "")]
        if pinned:
            url = pinned[0]["url"]
        if newer:  # informational only: outputs stay pinned to the 30.06.26 file
            try:
                st = requests.head(newer[0]["url"], headers=HEADERS, timeout=20, allow_redirects=True).status_code
            except requests.RequestException as e:
                st = f"error {type(e).__name__}"
            print(f"note: newer resource {NEWER_TAG} -> HTTP {st} (outputs stay pinned to {PIN_TAG})")
    except Exception as e:  # CKAN down: use the known resource URL
        print(f"note: CKAN lookup failed ({e}); using pinned URL")
    path = download(url, sub=SUB)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df = pd.read_excel(path, header=0)  # header is the first row (checked)
    df = df.loc[:, [c for c in df.columns if not str(c).startswith("Unnamed")]]
    df.columns = [" ".join(str(c).split()) for c in df.columns]
    df = df.dropna(how="all").reset_index(drop=True)
    return df, url


def clean(s) -> str:
    t = " ".join(str(s).split())
    if t.endswith('"') and t.count('"') % 2 == 1:
        t = t[:-1].rstrip()
    return t


def row_key(it, prev_it) -> str:
    if pd.notna(it):
        return f"pnrr_{int(it):03d}"
    return f"pnrr_{int(prev_it):03d}b"  # one row of the file has no counter: key it after the previous row


def sub_line(title: str, linea: str) -> str:
    m = re.search(r"sub-investimento\s*(1\.\d\.\d)", title)
    return m.group(1) if m else linea


def classify(r) -> tuple[bool, str | None, str]:
    it = int(r["it"]) if pd.notna(r["it"]) else None
    title = r["title"]
    if it in HAND:
        keep, theme, reason, check, _ = HAND[it]
        assert check.lower() in title.lower(), f"hand tag {it} does not match title: {title[:80]}"
        return keep, theme, reason
    m, c = int(r["MISSIONE"]), int(r["COMPONENTE"])
    if m in MISSION_REASON:
        return False, None, MISSION_REASON[m]
    if m == 5 and c == 2:
        line = str(r["LINEA DI INVESTIMENTO"]).strip()
        if line.split(".")[0] == "1" and line in ("1.1", "1.2", "1.3"):
            sl = sub_line(title, line)
            theme, reason = LINE_THEME[sl]
            return True, theme, reason
        for pat, reason in EXCL_RULES:
            if re.search(pat, title, flags=re.I):
                return False, None, f"M5C2 {line}: {reason}"
        raise ValueError(f"unclassified M5C2 row it={it}: {title}")
    raise ValueError(f"unclassified row it={it} M{m}C{c}: {title}")


# ---------------- geocoding ----------------
_rl = RateLimiter(1.1)


def geocode(addr: str, cache: dict) -> list[dict]:
    """All Nominatim hits (cached) whose house number matches the address number, inside Turin."""
    q = f"{addr}, Torino, Italia"
    if q not in cache:
        _rl.wait()
        r = requests.get(NOMINATIM, params={"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 3,
                                            "countrycodes": "it", "viewbox": "7.57,45.15,7.78,44.99", "bounded": 1},
                         headers={"User-Agent": GEO_UA}, timeout=60)
        r.raise_for_status()
        cache[q] = r.json()
        GEO_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    want = re.search(r"(\d+)\s*$", addr).group(1)
    out = []
    for h in cache[q]:
        hn = str((h.get("address") or {}).get("house_number", ""))
        lon, lat = float(h["lon"]), float(h["lat"])
        if re.match(rf"^{want}(\D|$)", hn) and in_turin(lon, lat, pad=0):
            m = re.search(r"Circoscrizione (\d)", h.get("display_name", ""))
            out.append({"lon": lon, "lat": lat, "display": h.get("display_name", ""), "hn": hn,
                        "osm_circ": int(m.group(1)) if m else None})
    return out


def locate(addrs: list[str], zones: gpd.GeoDataFrame, zones_m: gpd.GeoDataFrame, cache: dict):
    """Return (zone_id, circ, evidence) for a list of addresses of one row.

    Every matching hit of an address (e.g. several 'int.' entrances) must fall in the same zone.
    """
    found = []
    for a in addrs:
        hits = geocode(a, cache)
        if not hits:
            return None, None, f"'{a}': no house-number match in Nominatim -> citywide"
        hz, edges = set(), []
        for g in hits:
            pt = Point(g["lon"], g["lat"])
            inside = zones[zones.contains(pt)]
            if len(inside) != 1:
                return None, None, f"'{a}': geocoded point not inside exactly one zone -> citywide"
            hz.add(int(inside.iloc[0]["id"]))
            ptm = gpd.GeoSeries([pt], crs=WGS84).to_crs(METRIC_CRS).iloc[0]
            edges.append(zones_m.loc[inside.index[0], "geometry"].boundary.distance(ptm))
        if len(hz) != 1:
            return None, None, f"'{a}': Nominatim hits fall in zones {sorted(hz)} -> citywide"
        zid = hz.pop()
        z = zones[zones["id"] == zid].iloc[0]
        osm_c = {g["osm_circ"] for g in hits}
        found.append((a, hits[0], zid, str(z["name"]), int(z["circ"]), (min(edges), max(edges)), len(hits), osm_c))
    ev = "; ".join(
        f"Nominatim '{a}' -> '{g['display'][:60]}' (n. {g['hn']}; {n} matching hit(s), all in zone {zid}) "
        f"= zone {zid} {zn} (circ {zc}; OSM says Circoscrizione {'/'.join(map(str, sorted(c for c in oc if c)))}), "
        f"{edge[0]:.0f}-{edge[1]:.0f} m from zone edge"
        for a, g, zid, zn, zc, edge, n, oc in found)
    zids = {f[2] for f in found}
    circs = {f[4] for f in found}
    near = [f for f in found if f[5][1] < NEAR_EDGE_M]  # most interior agreeing hit still near the edge
    if len(zids) == 1 and not near:
        return found[0][2], found[0][4], ev
    if len(circs) == 1:
        why = "point within %.0f m of zone edge" % NEAR_EDGE_M if near else "sites in different zones"
        return None, found[0][4], ev + f" -> {why}, same circ: placed at circ level only"
    return None, None, ev + " -> sites in different Circoscrizioni: citywide"


def main():
    df, url = load_xlsx()
    df["title"] = df["INTERVENTO"].map(clean)
    keys, prev = [], 0
    for it in df["it"]:
        keys.append(row_key(it, prev))
        prev = it if pd.notna(it) else prev
    df["key"] = keys
    assert df["key"].is_unique

    dec = df.apply(classify, axis=1, result_type="expand")
    df["keep"], df["theme"], df["reason"] = dec[0], dec[1], dec[2]
    df["amount_eur"] = df["TOTALE RISORSE"].astype(float)
    df["progress_pct"] = (df["PERCENTUALE AVANZAMENTO INTERVENTO"].astype(float) * 100).round(1)
    df["programme"] = [f"{FONDO.get(str(f).strip(), str(f).strip())} M{int(m)}C{int(c)}"
                       for f, m, c in zip(df["TIPOLOGIA FONDO"], df["MISSIONE"], df["COMPONENTE"])]

    zones = gpd.read_file(WORK / "zones_base.geojson").to_crs(WGS84)
    zones_m = zones.to_crs(METRIC_CRS)
    zb = pd.read_csv(WORK / "zones_base.csv")
    cache = json.loads(GEO_CACHE.read_text(encoding="utf-8")) if GEO_CACHE.exists() else {}

    zone_ids, circs, evid = [], [], []
    for _, r in df.iterrows():
        it = int(r["it"]) if pd.notna(r["it"]) else None
        if not r["keep"]:
            zone_ids.append(None); circs.append(None); evid.append("")
            continue
        addrs = HAND[it][4] if it in HAND else []
        if addrs:
            zid, circ, ev = locate(addrs, zones, zones_m, cache)
        else:
            zid, circ = None, None
            ev = (LOC_NOTE.get(it) or "no address, place or Circoscrizione in the text") + " -> citywide"
        zone_ids.append(zid); circs.append(circ); evid.append(ev)
    df["zone_id"], df["circ"], df["location_evidence"] = zone_ids, circs, evid
    df["zone_id"] = df["zone_id"].astype("Int64")
    df["circ"] = df["circ"].astype("Int64")

    # ---- funded_tags.csv: every row, with the decision ----
    tags = df[["key", "CUP", "title", "programme", "LINEA DI INVESTIMENTO", "TAG AMBITO DI AZIONE (Giunta)",
               "amount_eur", "keep", "theme", "reason", "zone_id", "circ", "location_evidence"]].rename(
        columns={"LINEA DI INVESTIMENTO": "linea", "TAG AMBITO DI AZIONE (Giunta)": "tag_giunta"})
    tags["CUP"] = tags["CUP"].astype(str).str.strip()
    tags["tag_giunta"] = tags["tag_giunta"].map(clean)
    tags.to_csv(WORK / "funded_tags.csv", index=False, encoding="utf-8")

    # ---- funded.json: kept rows ----
    k = df[df["keep"]].copy()
    recs = []
    for _, r in k.iterrows():
        recs.append({
            "id": r["key"], "title": r["title"], "programme": r["programme"],
            "amount_eur": float(r["amount_eur"]),
            "progress_pct": None if pd.isna(r["progress_pct"]) else float(r["progress_pct"]),
            "circ": None if pd.isna(r["circ"]) else int(r["circ"]),
            "zone_id": None if pd.isna(r["zone_id"]) else int(r["zone_id"]),
            "theme": r["theme"], "source": SOURCE,
        })
    (WORK / "funded.json").write_text(json.dumps(recs, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- funded_zone.csv ----
    located = k[k["zone_id"].notna()]
    circ_only = k[k["zone_id"].isna() & k["circ"].notna()]
    city = k[k["zone_id"].isna() & k["circ"].isna()]
    z = zb[["id", "circ", "pop_2025"]].copy()
    z["direct_eur"] = z["id"].map(located.groupby("zone_id")["amount_eur"].sum()).fillna(0.0)
    circ_eur = circ_only.groupby("circ")["amount_eur"].sum()
    circ_n = circ_only.groupby("circ").size()
    circ_pop = z.groupby("circ")["pop_2025"].sum()
    z["circ_alloc_eur"] = (z["circ"].map(circ_eur).fillna(0.0) * z["pop_2025"] / z["circ"].map(circ_pop)).round(2)
    z["funded_eur"] = (z["direct_eur"] + z["circ_alloc_eur"]).round(2)
    z["funded_projects"] = (z["id"].map(located.groupby("zone_id").size()).fillna(0)
                            + z["circ"].map(circ_n).fillna(0)).astype(int)
    z["citywide_eur_total"] = float(city["amount_eur"].sum())
    z["circ_alloc_method"] = "calculation: circ-level rows spread to the circ's zones by pop_2025 share"
    out = z[["id", "direct_eur", "circ_alloc_eur", "funded_eur", "funded_projects", "citywide_eur_total",
             "circ_alloc_method"]]
    assert len(out) == 94 and out["id"].is_unique
    out.to_csv(WORK / "funded_zone.csv", index=False)

    # ---- checks + summary ----
    tot_alloc = out["direct_eur"].sum() + out["circ_alloc_eur"].sum() + city["amount_eur"].sum()
    assert abs(tot_alloc - k["amount_eur"].sum()) < 1.0, "zone + circ + citywide must equal kept total"
    print(f"source: {url}")
    print(f"total rows: {len(df)}   total euro: {df['amount_eur'].sum():,.0f}")
    print(f"kept rows: {len(k)}   kept euro: {k['amount_eur'].sum():,.0f}")
    for lab, part in (("zone", located), ("circ only", circ_only), ("citywide", city)):
        print(f"  located {lab:<9}: {len(part):>3} rows  {part['amount_eur'].sum():>14,.0f} EUR")
    print("kept by theme:")
    print(k.groupby("theme")["amount_eur"].agg(["size", "sum"]).to_string())
    print("placements:")
    for _, r in k[k["zone_id"].notna() | k["circ"].notna()].iterrows():
        print(f"  {r['key']} zone={r['zone_id']} circ={r['circ']} {r['amount_eur']:,.0f}  {r['title'][:60]}")
        print(f"      {r['location_evidence']}")


if __name__ == "__main__":
    main()
