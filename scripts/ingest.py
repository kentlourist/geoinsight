"""Normalisasi sumber peta geologi (sources/<id>/) -> data/<id>.geojson + data/catalog.json."""
import json, pathlib, hashlib
import geopandas as gpd
from shapely import make_valid

SRC, DATA = pathlib.Path("sources"), pathlib.Path("data")
PALETTE = ["#e0c040","#4080e0","#50b878","#c070c0","#e07040","#70c0d0","#a0a060","#d06080","#8080e0","#60a040","#c09060","#9090a0"]
color_for = lambda s: PALETTE[int(hashlib.md5(s.encode()).hexdigest(), 16) % len(PALETTE)]

def find_file(d):
    for pat in ("*.zip", "*.shp", "*.geojson"):
        for f in sorted(d.glob(pat)): return f
    raise ValueError("Tidak ada file .zip/.shp/.geojson di folder sumber")

def ingest(d):
    m = json.loads((d / "source.json").read_text())
    f = find_file(d)
    gdf = gpd.read_file(f"zip://{f}" if f.suffix == ".zip" else f)
    fm = m.get("fields", {})
    if "name" not in fm or any(v not in gdf.columns for v in fm.values()):
        raise ValueError(f"Isi 'fields' di source.json (minimal name). Kolom tersedia: {list(gdf.columns)}")
    if gdf.crs is None:
        if not m.get("crs"): raise ValueError('CRS tidak ada di file. Isi "crs": "EPSG:xxxx" di source.json')
        gdf = gdf.set_crs(m["crs"])
    gdf = gdf.to_crs(4326)
    gdf = gdf[gdf.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    gdf["geometry"] = gdf.geometry.apply(make_valid).simplify(m.get("simplify_deg", 0.0002), preserve_topology=True)
    out = gpd.GeoDataFrame({
        "name": gdf[fm["name"]].fillna("Tanpa nama").astype(str),
        "lith": gdf[fm["lith"]].fillna("-").astype(str) if "lith" in fm else "-",
        "age": gdf[fm["age"]].fillna("-").astype(str) if "age" in fm else "-",
    }, geometry=gdf.geometry, crs=4326)
    out["color"] = gdf[fm["color"]].astype(str) if "color" in fm else out["name"].map(color_for)
    out["source"] = d.name
    DATA.mkdir(exist_ok=True)
    path = DATA / f"{d.name}.geojson"
    out.to_file(path, driver="GeoJSON")
    kb = round(path.stat().st_size / 1024)
    if kb > 25000: print(f"PERINGATAN {d.name}: {kb} KB, besar untuk dimuat di browser. Naikkan simplify_deg atau pecah per kabupaten.")
    keep = ("title", "publisher", "scale", "year", "license", "citation")
    return {"id": d.name, **{k: m.get(k, "-") for k in keep}, "file": f"data/{d.name}.geojson",
            "color": "#ff5a5a", "bbox": [round(v, 5) for v in out.total_bounds], "features": len(out), "size_kb": kb}

def main():
    cat_f = DATA / "catalog.json"
    cat = {e["id"]: e for e in json.loads(cat_f.read_text())} if cat_f.exists() else {}
    for d in sorted(p for p in SRC.iterdir() if (p / "source.json").exists()):
        try:
            cat[d.name] = ingest(d); print("OK", d.name, cat[d.name]["features"], "fitur")
        except Exception as e:
            print("GAGAL", d.name, e)
    DATA.mkdir(exist_ok=True)
    cat_f.write_text(json.dumps(list(cat.values()), ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
