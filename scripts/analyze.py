"""Irisan batas wilayah (input/) dengan satuan geologi Macrostrat -> results/<id>/."""
import json, os, pathlib, re, time
from datetime import datetime, timezone
import numpy as np, requests, geopandas as gpd, pandas as pd
from shapely import make_valid
from shapely.geometry import box, Point

API = "https://macrostrat.org/api/v2/geologic_units/map"
IN, OUT = pathlib.Path("input"), pathlib.Path("results")
MAX_DEG = 5          # batas sisi bounding box (derajat)
N_SAMPLE = 300       # jumlah titik untuk metode cadangan
KEYS = ["name", "lith", "age", "color"]
FORCE = os.environ.get("FORCE") == "1"   # True: hitung ulang semua file input

def load(p):
    gdf = gpd.read_file(f"zip://{p}" if p.suffix == ".zip" else p)
    notes = []
    if gdf.crs is None:
        gdf = gdf.set_crs(4326); notes.append("CRS tidak ada di file, diasumsikan WGS84")
    gdf = gdf.to_crs(4326)
    gdf = gdf[gdf.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if gdf.empty: raise ValueError("File tidak berisi poligon")
    gdf["geometry"] = gdf.geometry.apply(make_valid)
    return gdf[["geometry"]], notes

def clean(df):
    df = df.copy()
    if "name" not in df: df["name"] = None
    df["name"] = df["name"].fillna(df.get("strat_name")).fillna("Tanpa nama")
    if "age" not in df or df["age"].isna().all():
        df["age"] = (df.get("b_int").astype(str) + " – " + df.get("t_int").astype(str)) if "b_int" in df and "t_int" in df else "-"
    for k, d in (("lith", "-"), ("color", "#888888"), ("age", "-")):
        if k not in df: df[k] = d
        df[k] = df[k].fillna(d).astype(str)
    return df

def fetch_polygons(aoi):
    minx, miny, maxx, maxy = aoi.bounds
    if maxx - minx > MAX_DEG or maxy - miny > MAX_DEG:
        raise ValueError(f"Area terlalu luas (maks {MAX_DEG}° per sisi). Pecah wilayah kajian.")
    r = requests.get(API, params={"shape": box(*aoi.bounds).wkt, "scale": "medium",
                                  "format": "geojson_bare", "response": "long"}, timeout=180)
    r.raise_for_status()
    feats = r.json().get("features", [])
    if not feats: return None
    g = gpd.GeoDataFrame.from_features(feats, crs=4326)
    g["geometry"] = g.geometry.apply(make_valid)
    return clean(g)

def sample_units(aoi):
    minx, miny, maxx, maxy = aoi.bounds
    step = max(np.sqrt(aoi.area / N_SAMPLE), 1e-4)
    pts = [Point(x, y) for x in np.arange(minx, maxx, step) for y in np.arange(miny, maxy, step)]
    pts = [p for p in pts if aoi.contains(p)][:N_SAMPLE * 2]
    rows = []
    for p in pts:
        try:
            d = requests.get(API, params={"lat": p.y, "lng": p.x, "scale": "medium", "response": "long"}, timeout=60).json()["success"]["data"]
            if d: rows.append(d[0])
        except Exception: pass
        time.sleep(.05)
    if not rows: raise ValueError("Tidak ada satuan geologi ditemukan di area ini")
    return clean(pd.DataFrame(rows)), len(pts)

def local_sources(aoi_gdf, aoi, d, total):
    """Irisan AOI dengan setiap sumber di data/catalog.json (hasil ingest.py) yang tumpang tindih."""
    cf, out = pathlib.Path("data/catalog.json"), []
    if not cf.exists(): return out
    for m in json.loads(cf.read_text()):
        b = m.get("bbox")
        if not b or not box(*b).intersects(aoi): continue
        g = gpd.read_file(m["file"]); g["geometry"] = g.geometry.apply(make_valid)
        inter = gpd.overlay(g[KEYS + ["geometry"]], aoi_gdf, how="intersection")
        inter = inter[inter.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
        if inter.empty: continue
        inter["area_km2"] = km2(inter).round(4)
        inter.to_file(d / f"intersect_{m['id']}.geojson", driver="GeoJSON")
        sm = inter.groupby(KEYS, as_index=False)["area_km2"].sum()
        cov = float(sm["area_km2"].sum())
        sm["persen"] = (sm["area_km2"] / cov * 100).round(2); sm["area_km2"] = sm["area_km2"].round(3)
        sm = sm.sort_values("area_km2", ascending=False)
        sm.to_csv(d / f"summary_{m['id']}.csv", index=False)
        out.append({"id": m["id"], "title": m.get("title", m["id"]), "scale": m.get("scale", "-"), "year": m.get("year", "-"),
                    "covered_km2": round(cov, 3), "covered_pct": round(cov / total * 100, 1), "units": sm.to_dict("records")})
    return out

def km2(g): return g.to_crs(6933).area / 1e6

def analyze(p):
    gdf, notes = load(p)
    aoi = gdf.union_all()
    total = float(km2(gpd.GeoSeries([aoi], crs=4326)).iloc[0])
    try:
        units = fetch_polygons(aoi)
    except requests.RequestException:
        units = None
    res = {"id": p.stem, "total_km2": round(total, 3), "notes": notes}
    d = OUT / re.sub(r"\W+", "_", p.stem); d.mkdir(parents=True, exist_ok=True)
    if units is not None:
        inter = gpd.overlay(units[KEYS + ["geometry"]], gpd.GeoDataFrame(geometry=[aoi], crs=4326), how="intersection")
        inter = inter[inter.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
        inter["area_km2"] = km2(inter).round(4)
        inter.to_file(d / "intersect.geojson", driver="GeoJSON")
        sm = inter.groupby(KEYS, as_index=False)["area_km2"].sum()
        res["method"] = "interseksi poligon"
    else:
        s, n = sample_units(aoi)
        sm = s.groupby(KEYS, as_index=False).size().rename(columns={"size": "area_km2"})
        sm["area_km2"] = sm["area_km2"] / sm["area_km2"].sum() * total
        res["method"] = f"sampling {n} titik (perkiraan kasar)"
    sm["persen"] = (sm["area_km2"] / sm["area_km2"].sum() * 100).round(2)
    sm["area_km2"] = sm["area_km2"].round(3)
    sm = sm.sort_values("area_km2", ascending=False)
    sm.to_csv(d / "summary.csv", index=False)
    res["units"] = sm.to_dict("records")
    res["local"] = local_sources(gpd.GeoDataFrame(geometry=[aoi], crs=4326), aoi, d, total)
    res["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    res["dir"] = d.name
    (d / "summary.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    return res

def main():
    idx_f = OUT / "index.json"
    idx = {e["id"]: e for e in json.loads(idx_f.read_text())} if idx_f.exists() else {}
    for p in sorted(IN.iterdir()):
        if p.suffix.lower() not in (".zip", ".geojson", ".json") or (p.stem in idx and not FORCE): continue
        try:
            r = analyze(p)
            idx[p.stem] = {k: r[k] for k in ("id", "dir", "total_km2", "method", "generated")}
            print("OK", p.name)
        except Exception as e:
            idx[p.stem] = {"id": p.stem, "error": str(e)}; print("GAGAL", p.name, e)
    idx_f.write_text(json.dumps(list(idx.values()), ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
