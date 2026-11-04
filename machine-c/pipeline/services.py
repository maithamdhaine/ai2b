"""Services workstream: facility points and zone access distances.

Outputs
  work/services.geojson  Points (WGS84), properties {id, name, type, address, source, year}
  work/access.csv        one row per zone: distances (m) from the zone representative point
                         to the nearest hospital / RSA / pharmacy, and counts within 800 m.
Caches
  raw/services/          downloaded source files
  work/geocode_cache.json  every Nominatim answer (including "no result"), keyed by query text
  work/address_fixes.csv   hand fixes (original, fixed) for addresses Nominatim cannot place

Run: python services.py   (re-runnable; downloads and geocodes are cached)
"""
from __future__ import annotations

import csv
import json
import re
import sys

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from pyproj import Transformer
from shapely.geometry import Point
from shapely.ops import unary_union

from common import (METRIC_CRS, RAW, WGS84, WORK, RateLimiter, download, in_turin,
                    read_csv_it, to_num, unzip, wkt_csv_to_gdf)

SUB = "services"  # raw downloads go to raw/services/
RADIUS_M = 800  # team assumption: "within walking distance"
# care_m means "nearest residence for dependent elderly people": keep only RSA-file structures that
# have an elderly activity row (this drops 1 structure, the F.A.R.O. oncology hospice).
RSA_ONLY_ELDERLY = True
ELDERLY_ACT = "anziani non autosufficienti"
TYPES = ["hospital", "rsa", "pharmacy", "library", "market"]

# Source registry: key -> (label, url, year). Year = data year (file date inside the zip,
# server Last-Modified for the RSA csv, file-name date for the Ministry file).
SOURCES = {
    "aperto_ospedali": ("Comune di Torino (AperTO) - Ospedali",
                        "http://geoportale.comune.torino.it/geodati/zip/ospedali_csv.zip", 2016),
    "aperto_rsa": ("Comune di Torino (AperTO) - Residenze sanitarie assistenziali private "
                   "(file regpie_..., data from Regione Piemonte)",
                   "https://risorse.comune.torino.it/opendata/salute/"
                   "regpie_residente_sanitarie_assistenziali_private_comuneTO.csv", 2019),
    "aperto_biblioteche": ("Comune di Torino (AperTO) - Biblioteche",
                           "http://geoportale.comune.torino.it/geodati/zip/biblioteche_csv.zip", 2017),
    "aperto_mercati": ("Comune di Torino (AperTO) - Mercati",
                       "http://geoportale.comune.torino.it/geodati/zip/mercati_csv.zip", 2016),
    "minsalute_farmacie": ("Ministero della Salute - Farmacie (FRM_FARMA_5_20261104)",
                           "https://www.dati.salute.gov.it/sites/default/files/opendata/"
                           "FRM_FARMA_5_20261104.csv", 2026),
}
PHARMACY_URLS = [
    "https://www.dati.salute.gov.it/sites/default/files/opendata/FRM_FARMA_5_20261104.csv",
    "http://www.dati.salute.gov.it/sites/default/files/opendata/FRM_FARMA_5_20261104.csv",
]

# ---------------------------------------------------------------- geocoding
NOMINATIM = "https://nominatim.openstreetmap.org/search"
GEO_UA = "Bussola-AI2B-student-project/0.1"
VIEWBOX = "7.57,45.15,7.78,44.99"  # Turin bbox (lon_min, lat_max, lon_max, lat_min)
CACHE_PATH = WORK / "geocode_cache.json"
FIXES_PATH = WORK / "address_fixes.csv"
_limiter = RateLimiter(1.1)  # Nominatim policy: at most 1 request per second
GEO_LOG: list[dict] = []  # one entry per geocoded address, for the report


def _clean(s) -> str:
    return " ".join(str(s or "").replace(" ", " ").split())


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def load_fixes() -> dict:
    if not FIXES_PATH.exists():
        FIXES_PATH.write_text("original,fixed\n", encoding="utf-8")
        return {}
    fixes = {}
    with FIXES_PATH.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("original") and row.get("fixed"):
                fixes[_clean(row["original"]).upper()] = _clean(row["fixed"])
    return fixes


def nominatim(q: str, cache: dict) -> dict | None:
    """One Nominatim lookup, cached (a cached None means 'no result', not retried)."""
    if q in cache:
        return cache[q]
    _limiter.wait()
    try:
        r = requests.get(
            NOMINATIM,
            params={"q": q, "format": "json", "limit": 1, "countrycodes": "it",
                    "viewbox": VIEWBOX, "bounded": 1},
            headers={"User-Agent": GEO_UA, "Accept-Language": "it"},
            timeout=30,
        )
        r.raise_for_status()
        hits = r.json()
    except Exception as e:  # network errors are not cached, so a re-run retries them
        print(f"  ! geocode error for {q!r}: {e}")
        return None
    res = None
    if hits:
        h = hits[0]
        res = {"lat": float(h["lat"]), "lon": float(h["lon"]), "display_name": h.get("display_name"),
               "class": h.get("class"), "type": h.get("type"), "addresstype": h.get("addresstype")}
    cache[q] = res
    save_cache(cache)
    return res


def geocode(address: str, comune: str, cache: dict, fixes: dict, city, label: str = "") -> dict | None:
    """Geocode 'address, comune'. Uses a hand fix when one exists. Rejects points outside Turin."""
    orig = _clean(address)
    fixed = fixes.get(orig.upper())
    used = fixed or orig
    q = f"{used}, {_clean(comune).title()}"
    res = nominatim(q, cache)
    status = "ok"
    if res is None:
        status = "no_result"
    elif not in_turin(res["lon"], res["lat"], pad=0) or not inside_city(res["lon"], res["lat"], city):
        status = "outside_turin"
    # house_level False = Nominatim matched only a street, area or locality, or a different
    # house number than the one asked for (approximate point)
    cls, typ = (res or {}).get("class"), (res or {}).get("type")
    precise = bool(res) and not (cls in ("highway", "boundary", "landuse") or (cls == "place" and typ != "house"))
    # house number asked for: first number after the last comma, else the last number
    tail = used.rsplit(",", 1)[1] if "," in used else used
    nums = re.findall(r"\d+", tail)
    num = (nums[0] if "," in used else nums[-1]) if nums else None
    if precise and num:
        # the result's house number is the first comma-separated part starting with a digit
        # ("30 int. 8, Via ..." is house 30); it must equal the number asked for
        hn = next((p for p in res["display_name"].split(", ") if p[:1].isdigit()), "")
        if re.findall(r"\d+", hn)[:1] != [num]:
            precise = False
    entry = {"label": label, "original": orig, "query": q, "fixed": bool(fixed), "status": status,
             "match": (res or {}).get("display_name"), "osm": f"{cls}/{typ}", "house_level": precise}
    GEO_LOG.append(entry)
    if status != "ok":
        return None
    return {**res, "house_level": precise}


# ---------------------------------------------------------------- zones / city
def load_zones() -> gpd.GeoDataFrame:
    z = gpd.read_file(WORK / "zones_base.geojson")
    z["id"] = z["id"].astype(int)
    return z


def inside_city(lon: float, lat: float, city) -> bool:
    return city.contains(Point(lon, lat))


def city_shape(zones: gpd.GeoDataFrame, tol_m: float = 30.0):
    """Union of the 94 zones (= Comune di Torino), buffered by tol_m metres, in WGS84."""
    zm = zones.to_crs(METRIC_CRS)
    u = unary_union(zm.geometry.values).buffer(tol_m)
    return gpd.GeoSeries([u], crs=METRIC_CRS).to_crs(WGS84).iloc[0]


def rep_points_wgs(gdf: gpd.GeoDataFrame) -> gpd.GeoSeries:
    """Representative point of each geometry (computed in metres), returned in WGS84."""
    return gdf.geometry.to_crs(METRIC_CRS).representative_point().to_crs(WGS84)


def records(gdf: gpd.GeoDataFrame, typ: str, source: str) -> list[dict]:
    year = SOURCES[source][2]
    out = []
    for _, r in gdf.iterrows():
        out.append({"id": r["sid"], "name": _clean(r["name"]), "type": typ, "address": _clean(r["address"]),
                    "source": source, "year": int(year), "lon": float(r.geometry.x), "lat": float(r.geometry.y)})
    return out


# ---------------------------------------------------------------- sources
def hospitals(city) -> list[dict]:
    p = download(SOURCES["aperto_ospedali"][1], "ospedali_csv.zip", sub=SUB)
    g = wkt_csv_to_gdf(unzip(p) / "ospedali.csv")
    print(f"hospitals: {len(g)} access points, geometry types {g.geom_type.value_counts().to_dict()}")
    g["geometry"] = rep_points_wgs(g)
    g["name"] = g["DENOMINAZ"].map(_clean)
    inside = g.geometry.map(lambda pt: inside_city(pt.x, pt.y, city))
    print(f"  access points inside Turin: {int(inside.sum())}/{len(g)}")
    # One point per hospital: prefer the main entrance ("Principale", "Principale e PS").
    g["rank"] = g["TIPO_ACCES"].map(_clean).map(lambda t: 0 if t.startswith("Principale") else 1)
    g["idn"] = pd.to_numeric(g["ID_OSPEDAL"], errors="coerce")
    g = g[inside].sort_values(["name", "rank", "idn"]).drop_duplicates("name", keep="first")
    g["sid"] = "hospital_" + g["ID_OSPEDAL"].astype(str).str.strip()
    g["address"] = g["INDIRIZZO"]
    print(f"  distinct hospitals kept: {len(g)}")
    return records(g, "hospital", "aperto_ospedali")


def libraries(city) -> list[dict]:
    p = download(SOURCES["aperto_biblioteche"][1], "biblioteche_csv.zip", sub=SUB)
    g = wkt_csv_to_gdf(unzip(p) / "biblioteche.csv")
    g["geometry"] = rep_points_wgs(g)
    inside = g.geometry.map(lambda pt: inside_city(pt.x, pt.y, city))
    print(f"libraries: {len(g)} rows, inside Turin {int(inside.sum())}")
    g = g[inside].copy()
    g["sid"] = "library_" + g["ID_BIBLIOT"].astype(str).str.strip()
    g["name"], g["address"] = g["DENOMINAZ"], g["INDIRIZZO"]
    return records(g, "library", "aperto_biblioteche")


def markets(city) -> list[dict]:
    p = download(SOURCES["aperto_mercati"][1], "mercati_csv.zip", sub=SUB)
    g = wkt_csv_to_gdf(unzip(p) / "mercati.csv")
    print(f"markets: {len(g)} rows, geometry types {g.geom_type.value_counts().to_dict()} "
          "(polygons -> representative point, no geocoding needed)")
    g["geometry"] = rep_points_wgs(g)
    inside = g.geometry.map(lambda pt: inside_city(pt.x, pt.y, city))
    print(f"  inside Turin {int(inside.sum())}")
    g = g[inside].copy()
    g["sid"] = "market_" + g["ID_MERC"].astype(str).str.strip()
    g["name"] = "Mercato " + g["DENOM"].map(_clean)
    g["address"] = g["LUOGO"]
    return records(g, "market", "aperto_mercati")


def rsa(city, cache, fixes) -> list[dict]:
    p = download(SOURCES["aperto_rsa"][1], "regpie_residente_sanitarie_assistenziali_private_comuneTO.csv", sub=SUB)
    df = read_csv_it(p, sep=",", dtype=str)
    n_rows = len(df)
    elderly = df.groupby("Codice_struttura")["Attivita"].agg(lambda s: s.str.contains(ELDERLY_ACT, regex=False).any())
    df = df.sort_values("Id", key=lambda s: pd.to_numeric(s, errors="coerce")).drop_duplicates("Codice_struttura")
    print(f"rsa: {n_rows} activity rows -> {len(df)} structures (dedupe by Codice_struttura)")
    if RSA_ONLY_ELDERLY:
        other = df[~df["Codice_struttura"].map(elderly)]
        print(f"  excluded (no elderly RSA/RAF activity): {other[['Codice_struttura', 'Struttura']].values.tolist()}")
        df = df[df["Codice_struttura"].map(elderly)]
    out = []
    for _, r in df.iterrows():
        res = geocode(r["Indirizzo"], r["Comune"], cache, fixes, city, label=f"rsa_{r['Codice_struttura']}")
        if res is None:
            continue
        out.append({"id": f"rsa_{_clean(r['Codice_struttura'])}", "name": _clean(r["Struttura"]), "type": "rsa",
                    "address": _clean(r["Indirizzo"]).title() + ", Torino", "source": "aperto_rsa",
                    "year": SOURCES["aperto_rsa"][2], "lon": res["lon"], "lat": res["lat"]})
    print(f"  rsa placed: {len(out)}/{len(df)}")
    return out


def pharmacies(city, cache, fixes) -> list[dict] | None:
    path = None
    for url in PHARMACY_URLS:
        try:
            path = download(url, url.split("/")[-1], sub=SUB)
            break
        except Exception as e:
            print(f"pharmacies: download failed {url}: {e}")
    if path is None:
        print("pharmacies: no data, pharmacy_m will be null")
        return None
    df = read_csv_it(path, sep=";", dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    com = "comune" if "comune" in df.columns else "descrizionecomune"
    t = df[df[com].map(_clean).str.upper() == "TORINO"].copy()
    end = t["data_fine_validita"].fillna("").map(_clean)
    t = t[end.isin(["", "-"])].drop_duplicates("cod_farmacia")
    t["lat"], t["lon"] = to_num(t["latitudine"]), to_num(t["longitudine"])
    t["cap_n"] = pd.to_numeric(t["cap"], errors="coerce")
    t["cod_n"] = pd.to_numeric(t["cod_farmacia"], errors="coerce")
    t = t.sort_values("cod_n")
    print(f"pharmacies: {len(t)} active rows in comune TORINO "
          f"(data_fine_validita empty or '-'), tipologia {t['descrizione_tipologia'].value_counts().to_dict()}")
    # The Ministry lat/lon is unreliable for part of the rows. Flag a row as suspect when
    #  - its point is outside the city, or
    #  - its exact point is shared with a different address (geocoder fallback: 42 active rows sit on
    #    one Turin centre point, others on street centroids), or
    #  - its CAP is not a Turin CAP (10100 generic, 10121-10156).
    # Suspect rows are geocoded from the address (and dropped if that fails or lands outside Turin).
    t["addr_key"] = t["indirizzo"].map(lambda s: _clean(s).upper())
    key = t["latitudine"].map(_clean) + "|" + t["longitudine"].map(_clean)
    shared = (key.map(t.groupby(key)["addr_key"].nunique()) > 1).values
    outside = np.array([not (np.isfinite(lo) and np.isfinite(la) and inside_city(lo, la, city))
                        for lo, la in zip(t["lon"], t["lat"])])
    bad_cap = ~((t["cap_n"] == 10100) | t["cap_n"].between(10121, 10156)).values
    t["suspect"] = shared | outside | bad_cap
    print(f"  suspect coordinates: {int(t['suspect'].sum())} (outside Turin {int(outside.sum())}, "
          f"point shared with another address {int(shared.sum())}, non-Turin CAP {int(bad_cap.sum())}) "
          "-> geocoding those addresses")
    # A first validation sample (every 6th non-suspect row) showed the non-suspect Ministry points
    # are also far from the address (median 201 m, 7 of 15 more than 300 m), so every row is geocoded.
    # Location used: house-level Nominatim match > (non-suspect only) Ministry point > dropped.
    # A suspect row with only a street-level match is dropped: on a long street that point can be
    # km away from the pharmacy (e.g. Corso Vittorio Emanuele II 84 matched the far west end).
    tr = Transformer.from_crs(WGS84, METRIC_CRS, always_xy=True)
    out, val, dropped, kept_ministry = [], [], [], []
    for _, r in t.iterrows():
        cod = _clean(r["cod_farmacia"])
        res = geocode(r["indirizzo"], "Torino", cache, fixes, city, label=f"pharmacy_{cod}")
        if res is not None and not r["suspect"]:
            x1, y1 = tr.transform(r["lon"], r["lat"])
            x2, y2 = tr.transform(res["lon"], res["lat"])
            val.append({"cod": cod, "dist_m": float(np.hypot(x1 - x2, y1 - y2)), "house_level": res["house_level"]})
        if res is not None and res["house_level"]:
            lon, lat = res["lon"], res["lat"]
        elif not r["suspect"]:
            lon, lat = r["lon"], r["lat"]
            kept_ministry.append((cod, _clean(r["indirizzo"])))
        else:
            why = "street-level match only" if res is not None else "no match in Turin"
            dropped.append((cod, _clean(r["indirizzo"]), _clean(r["cap"]), why))
            continue
        out.append({"id": f"pharmacy_{cod}", "name": _clean(r["descrizione_farmacia"]), "type": "pharmacy",
                    "address": _clean(r["indirizzo"]) + ", Torino", "source": "minsalute_farmacie",
                    "year": SOURCES["minsalute_farmacie"][2], "lon": float(lon), "lat": float(lat)})
    v = pd.DataFrame(val)
    if len(v):
        hv = v[v["house_level"]]["dist_m"]
        print(f"  check of non-suspect Ministry points vs house-level OSM match (n={len(hv)}): median "
              f"{hv.median():.0f} m, p90 {hv.quantile(.9):.0f} m, max {hv.max():.0f} m, "
              f">100 m: {int((hv > 100).sum())}, >300 m: {int((hv > 300).sum())}")
    osm_pharm = sum(1 for g in GEO_LOG if g["label"].startswith("pharmacy_") and g["status"] == "ok"
                    and g["house_level"] and g["osm"] == "amenity/pharmacy")
    print(f"  placed from house-level OSM match: {len(out) - len(kept_ministry)} "
          f"(of which the OSM object is itself a pharmacy: {osm_pharm})")
    print(f"  kept Ministry point (no house-level match, not suspect): {kept_ministry}")
    print(f"  dropped (location not verifiable): {dropped}")
    print(f"  pharmacies placed: {len(out)}/{len(t)}")
    return out


def piemonte_listing() -> None:
    folder = RAW / "piemonte"
    files = sorted(p for p in folder.rglob("*") if p.is_file()) if folder.exists() else []
    print(f"raw/piemonte: {len(files)} file(s)" + ("" if files else " (nothing to use yet)"))
    for p in files:
        print(f"  {p.relative_to(RAW)} ({p.stat().st_size} bytes)")


# ---------------------------------------------------------------- outputs
def write_services(points: list[dict]) -> None:
    feats = [{"type": "Feature",
              "properties": {k: p[k] for k in ("id", "name", "type", "address", "source", "year")},
              "geometry": {"type": "Point", "coordinates": [round(p["lon"], 6), round(p["lat"], 6)]}}
             for p in points]
    fc = {"type": "FeatureCollection", "features": feats}
    (WORK / "services.geojson").write_text(json.dumps(fc, ensure_ascii=False, indent=0), encoding="utf-8")


def compute_access(zones: gpd.GeoDataFrame, points: list[dict], have_pharm: bool) -> pd.DataFrame:
    zm = zones.to_crs(METRIC_CRS)
    rep = zm.geometry.representative_point()
    zx, zy = rep.x.values, rep.y.values
    pts = gpd.GeoDataFrame(pd.DataFrame(points), geometry=[Point(p["lon"], p["lat"]) for p in points],
                           crs=WGS84).to_crs(METRIC_CRS)
    px, py = pts.geometry.x.values, pts.geometry.y.values
    d = np.hypot(zx[:, None] - px[None, :], zy[:, None] - py[None, :])  # zones x points, metres
    acc = pd.DataFrame({"id": zm["id"].values})
    types = pts["type"].values

    def nearest(t):
        m = types == t
        return pd.array(np.rint(d[:, m].min(axis=1)).astype(int), dtype="Int64") if m.any() else pd.NA

    acc["health_m"] = nearest("hospital")
    acc["care_m"] = nearest("rsa")
    acc["pharmacy_m"] = nearest("pharmacy") if have_pharm else pd.array([pd.NA] * len(acc), dtype="Int64")
    acc["services_800m"] = (d <= RADIUS_M).sum(axis=1).astype(int)
    acc["origin"] = "rep_point"
    for t in TYPES:
        col = f"{t}_n_800"
        if t == "pharmacy" and not have_pharm:
            acc[col] = pd.array([pd.NA] * len(acc), dtype="Int64")
        else:
            acc[col] = (d[:, types == t] <= RADIUS_M).sum(axis=1).astype(int)
    return acc


def main() -> int:
    zones = load_zones()
    city = city_shape(zones)
    cache, fixes = load_cache(), load_fixes()
    piemonte_listing()

    pts = hospitals(city) + libraries(city) + markets(city) + rsa(city, cache, fixes)
    ph = pharmacies(city, cache, fixes)
    have_pharm = ph is not None and len(ph) > 0
    pts += ph or []

    # final guard: only points inside Turin, unique ids
    pts = [p for p in pts if in_turin(p["lon"], p["lat"], pad=0) and inside_city(p["lon"], p["lat"], city)]
    ids = pd.Series([p["id"] for p in pts])
    assert ids.is_unique, ids[ids.duplicated()].tolist()
    write_services(pts)

    acc = compute_access(zones, pts, have_pharm)
    assert len(acc) == 94 and acc["id"].is_unique
    acc.to_csv(WORK / "access.csv", index=False)

    # ---- report
    counts = pd.Series([p["type"] for p in pts]).value_counts().reindex(TYPES, fill_value=0)
    print("\nservices.geojson points per type:", counts.to_dict(), "total", int(counts.sum()))
    fails = [g for g in GEO_LOG if g["status"] != "ok"]
    approx = [g for g in GEO_LOG if g["status"] == "ok" and not g["house_level"]]
    print(f"geocoded addresses: {len(GEO_LOG)}, failed {len(fails)}, street-level only {len(approx)}")
    for g in fails:
        print(f"  FAIL {g['label']}: {g['original']!r} (query {g['query']!r}) -> {g['status']}")
    for g in approx:
        print(f"  approx {g['label']}: {g['original']!r} -> {g['osm']} {g['match']}")
    names = zones.set_index("id")["name"]
    print("\naccess.csv summary (m):")
    print(acc[["health_m", "care_m", "pharmacy_m", "services_800m"]].describe().round(0).to_string())
    for zid in (1, 30, 61):
        if zid in set(acc["id"]):
            row = acc[acc["id"] == zid].iloc[0].to_dict()
            print(f"  zone {zid} {names.get(zid)}: {row}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
