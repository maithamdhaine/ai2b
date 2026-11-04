"""Shared helpers for the Bussola pipeline: paths, downloads, CKAN lookup, parsing.

Every workstream imports from here. Only the lead edits this file.
"""
from __future__ import annotations

import io
import json
import re
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
WORK = ROOT / "work"
OUT = ROOT / "out"
for _d in (RAW, WORK, OUT):
    _d.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept": "*/*"}
CKAN = "https://aperto.comune.torino.it/api/3/action"

# Turin projected CRS. Monte Mario / Italy zone 1.
SRC_CRS = "EPSG:3003"
WGS84 = "EPSG:4326"
# Metric CRS for distances (UTM 32N, good for Turin).
METRIC_CRS = "EPSG:32632"
# Turin bounding box in WGS84 (lon_min, lat_min, lon_max, lat_max) for sanity checks.
TURIN_BBOX = (7.57, 44.99, 7.78, 45.15)


def download(url: str, name: str | None = None, sub: str = "", force: bool = False) -> Path:
    """Download url into raw/<sub>/<name> once. Returns the local path."""
    folder = RAW / sub if sub else RAW
    folder.mkdir(parents=True, exist_ok=True)
    name = name or url.rstrip("/").split("/")[-1].split("?")[0]
    path = folder / name
    if path.exists() and path.stat().st_size > 0 and not force:
        return path
    r = requests.get(url, headers=HEADERS, timeout=120)
    r.raise_for_status()
    path.write_bytes(r.content)
    return path


def ckan_package(name: str) -> dict:
    """Return the CKAN package dict for an AperTO dataset name, cached in raw/ckan/."""
    cache = RAW / "ckan" / f"{name}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    r = requests.get(f"{CKAN}/package_show", params={"id": name}, headers=HEADERS, timeout=60)
    r.raise_for_status()
    pkg = r.json()["result"]
    cache.write_text(json.dumps(pkg, ensure_ascii=False, indent=1), encoding="utf-8")
    return pkg


def ckan_search(q: str, rows: int = 20) -> list[dict]:
    r = requests.get(f"{CKAN}/package_search", params={"q": q, "rows": rows}, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()["result"]["results"]


def ckan_resources(name: str) -> list[dict]:
    """List resources: [{name, format, url}] for a dataset."""
    pkg = ckan_package(name)
    return [
        {"name": r.get("name"), "format": (r.get("format") or "").lower(), "url": r.get("url")}
        for r in pkg.get("resources", [])
    ]


def fetch_dataset(name: str, pick=None, sub: str = "aperto") -> Path:
    """Download one resource of a CKAN dataset. `pick(resource)->bool` chooses; default first CSV."""
    res = ckan_resources(name)
    if pick is None:
        pick = lambda r: r["format"] in ("csv",) or r["url"].lower().endswith(".csv")
    chosen = [r for r in res if pick(r)] or res
    url = chosen[0]["url"]
    fname = f"{name}__{url.rstrip('/').split('/')[-1].split('?')[0]}"
    return download(url, fname, sub=sub)


def sniff_text(path: Path, n: int = 2000) -> str:
    raw = Path(path).read_bytes()[:n]
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1", errors="replace")


def read_csv_it(path, sep: str | None = None, **kw) -> pd.DataFrame:
    """Read an Italian open-data CSV: guesses separator, tries utf-8 then latin-1, decimal comma."""
    head = sniff_text(path)
    if sep is None:
        first = head.splitlines()[0] if head else ""
        sep = ";" if first.count(";") >= first.count(",") else ","
    decimal = "," if sep == ";" else "."
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, sep=sep, decimal=decimal, encoding=enc, **kw)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"cannot decode {path}")


def to_num(s: pd.Series) -> pd.Series:
    """Italian number text to float: '1.234,5' -> 1234.5, blanks -> NaN."""
    if s.dtype.kind in "if":
        return s.astype(float)
    t = s.astype(str).str.strip().str.replace("€", "", regex=False).str.replace(" ", "", regex=False)
    has_comma = t.str.contains(",", regex=False)
    t = t.where(~has_comma, t.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    t = t.replace({"": None, "nan": None, "None": None, "-": None})
    return pd.to_numeric(t, errors="coerce")


def unzip(path: Path, dest: Path | None = None) -> Path:
    dest = dest or path.with_suffix("")
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        z.extractall(dest)
    return dest


def wkt_csv_to_gdf(csv_path: Path, wkt_col: str = "WKT_GEOM", crs: str = SRC_CRS):
    """Comune di Torino geoportale CSV with WKT geometry -> GeoDataFrame in WGS84."""
    import geopandas as gpd
    from shapely import wkt

    df = read_csv_it(csv_path, sep=";", dtype=str)
    geom = df[wkt_col].map(lambda s: wkt.loads(s) if isinstance(s, str) and s.strip() else None)
    gdf = gpd.GeoDataFrame(df.drop(columns=[wkt_col]), geometry=geom, crs=crs).to_crs(WGS84)
    return gdf


def in_turin(lon: float, lat: float, pad: float = 0.02) -> bool:
    a, b, c, d = TURIN_BBOX
    return (a - pad) <= lon <= (c + pad) and (b - pad) <= lat <= (d + pad)


def norm(s: str) -> str:
    s = str(s).lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


class RateLimiter:
    def __init__(self, min_interval: float = 1.1):
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self):
        dt = time.time() - self._last
        if dt < self.min_interval:
            time.sleep(self.min_interval - dt)
        self._last = time.time()
