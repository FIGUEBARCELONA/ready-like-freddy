#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
from shapely.geometry import box, mapping, shape
from shapely.validation import explain_validity

TARGET_GISCO_ID = "DE_11000000"
SOURCE_URL = "https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2024_4326.geojson"
G23_BBOX = {"min_lon":13.536366254666689,"min_lat":52.45118716566672,"max_lon":13.760019,"max_lat":52.52612733233339}

def canonical_bytes(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: validate_gisco_g23.py SOURCE_GEOJSON OUTPUT_DIR")
    source_path, output_dir = Path(sys.argv[1]), Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    raw = source_path.read_bytes()
    if not raw:
        raise RuntimeError("Authoritative source is empty")
    document = json.loads(raw.decode("utf-8"))
    features = document.get("features")
    if not isinstance(features, list):
        raise RuntimeError("GeoJSON FeatureCollection has no feature list")
    matches = []
    for feature in features:
        props = feature.get("properties", {})
        if (props.get("GISCO_ID") or props.get("gisco_id")) == TARGET_GISCO_ID:
            matches.append(feature)
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {TARGET_GISCO_ID} feature; found {len(matches)}")
    berlin_feature = matches[0]
    berlin_geom = shape(berlin_feature["geometry"])
    if berlin_geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise RuntimeError(f"Unexpected Berlin geometry type: {berlin_geom.geom_type}")
    if not berlin_geom.is_valid:
        raise RuntimeError("Invalid Berlin geometry: " + explain_validity(berlin_geom))
    clipped = berlin_geom.intersection(box(G23_BBOX["min_lon"], G23_BBOX["min_lat"], G23_BBOX["max_lon"], G23_BBOX["max_lat"]))
    if clipped.is_empty:
        raise RuntimeError("G23 intersection is empty")
    if not clipped.is_valid:
        raise RuntimeError("Invalid G23 intersection: " + explain_validity(clipped))
    berlin_bytes = canonical_bytes(berlin_feature)
    clipped_feature = {"type":"Feature","properties":{"zone_id":"DE_11000000_G23","source_gisco_id":TARGET_GISCO_ID,"source_url":SOURCE_URL,"crs":"EPSG:4326","geometry_role":"OFFICIAL_LAU_CLIPPED_GRID_CELL"},"geometry":mapping(clipped)}
    clipped_bytes = canonical_bytes(clipped_feature)
    berlin_path = output_dir / "DE_11000000_Berlin.normalized.geojson"
    clipped_path = output_dir / "DE_11000000_G23.clipped.normalized.geojson"
    berlin_path.write_bytes(berlin_bytes)
    clipped_path.write_bytes(clipped_bytes)
    manifest = {"schema_version":"1.0.0","gate_pass":True,"source":{"url":SOURCE_URL,"filename":source_path.name,"bytes":len(raw),"sha256":sha256_bytes(raw)},"berlin":{"gisco_id":TARGET_GISCO_ID,"geometry_type":berlin_geom.geom_type,"valid":True,"bounds":list(berlin_geom.bounds),"normalized_filename":berlin_path.name,"normalized_sha256":sha256_bytes(berlin_bytes)},"g23":{"bbox":G23_BBOX,"geometry_type":clipped.geom_type,"valid":True,"empty":False,"bounds":list(clipped.bounds),"area_degrees2":clipped.area,"normalized_filename":clipped_path.name,"normalized_sha256":sha256_bytes(clipped_bytes)}}
    (output_dir / "G23_GEOMETRY_CAPTURE_MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
