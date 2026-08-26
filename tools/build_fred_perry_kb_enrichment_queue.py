#!/usr/bin/env python3
"""Build Fred Perry KB enrichment queues from captured product URL maps.

This is a KB pipeline, not a resale-pool filter. Product pages are retained
regardless of present availability. No data or image URL is fabricated.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PRODUCT_FIELDS = [
    "kb_product_seed_id", "retailer_rank", "store", "domain", "product_identity",
    "source_url", "canonical_url", "source_status", "source_method", "http_status",
    "product_name_raw", "model_name_normalized", "style_code", "colour_name_official",
    "colour_code", "colour_visual_normalized", "year_exact", "season", "year_from",
    "year_to", "dating_basis", "factory_name", "factory_country",
    "manufacturer_legal_entity", "material_outer", "material_lining", "material_trim",
    "care_instructions_raw", "product_category", "gender_marketing", "evidence_grade",
    "completeness_state", "captured_at_utc", "source_sha256",
]

RESEARCH_FIELDS = [
    "kb_product_seed_id", "research_area", "priority", "current_value", "required_evidence",
    "status", "source_url", "notes",
]

IMAGE_FIELDS = [
    "kb_product_seed_id", "image_role", "required", "source_image_url", "referring_page_url",
    "original_filename", "mime_type", "width_px", "height_px", "sha256_bytes",
    "perceptual_hash", "original_path", "normalized_path", "evidence_grade",
    "status", "notes",
]

IMAGE_ROLES = [
    ("GEN_FRONT_FULL", True),
    ("GEN_BACK_FULL", True),
    ("GEN_SIDE_OR_INTERIOR", True),
    ("GEN_CONTEXT_DETAIL", True),
    ("MACRO_BRAND_LABEL_FRONT", True),
    ("MACRO_BRAND_LABEL_BACK_OR_STITCHING", True),
    ("MACRO_CARE_LABEL_FRONT", True),
    ("MACRO_CARE_LABEL_REVERSE", True),
    ("MACRO_STYLE_SIZE_COLOUR_CODE", True),
    ("MACRO_FACTORY_OR_CONSTRUCTION", True),
]

RESEARCH_AREAS = [
    ("MODEL_STYLE", "P0", "Official model name and exact style code from direct evidence"),
    ("YEAR_SEASON", "P0", "Exact dated source or bounded chronology with explicit basis"),
    ("COLOUR", "P0", "Official colour name/code for this exact product variant"),
    ("FACTORY_ORIGIN", "P0", "Physical label, traceable plant/company code or primary manufacturing bridge"),
    ("MATERIAL_COMPOSITION", "P0", "Physical care label or exact official/authoritative product data"),
    ("GENERIC_IMAGES", "P0", "Four distinct product views from captured evidence"),
    ("FORENSIC_MACROS", "P0", "Five or six legible label/construction macro images"),
]

GENERIC_PATH_SEGMENTS = {
    "men", "women", "kids", "sale", "outlet", "brand", "brands", "collections",
    "collection", "product", "products", "fred-perry", "fredperry", "en", "de", "fr",
    "es", "it", "nl", "be", "at", "ch", "uk", "eu", "au", "us", "pt", "pl",
}


def read_csvs(root: Path, names: set[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen_paths: set[Path] = set()
    for name in names:
        for path in root.rglob(name):
            if path in seen_paths:
                continue
            seen_paths.add(path)
            with path.open("r", encoding="utf-8-sig", newline="") as f:
                rows.extend(csv.DictReader(f))
    return rows


def normalize_url(url: str) -> str:
    if not url:
        return ""
    p = urllib.parse.urlsplit(url.strip())
    query = []
    for key, value in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        low = key.lower()
        if low.startswith("utm_") or low in {"gclid", "fbclid", "srsltid", "ref", "source"}:
            continue
        query.append((key, value))
    path = re.sub(r"/{2,}", "/", p.path or "/")
    return urllib.parse.urlunsplit((p.scheme or "https", p.netloc.lower(), path, urllib.parse.urlencode(query), ""))


def identity_from_url(domain: str, url: str, supplied: str = "") -> str:
    if supplied:
        return supplied
    p = urllib.parse.urlsplit(normalize_url(url))
    path = urllib.parse.unquote(p.path).lower().rstrip("/")
    query = dict(urllib.parse.parse_qsl(p.query))
    for key in ("productid", "product_id", "pid", "sku", "style"):
        if query.get(key):
            return f"{domain}:q:{key}:{query[key].lower()}"
    for pattern in (
        r"/prd/(\d+)(?:/|$)", r"/style/([a-z0-9-]+)(?:/|$)",
        r"/(\d{7,})/p(?:/|$)", r"/p/[^/]+/(\d{6,})(?:/|$)",
        r"/(?:product|products)/[^?#]*/(\d{5,})(?:/|$)",
    ):
        match = re.search(pattern, path)
        if match:
            return f"{domain}:id:{match.group(1)}"
    style_codes = re.findall(r"(?<![a-z0-9])([a-z]{1,5}\d{3,7}(?:-\d{2,4})?)(?![a-z0-9])", path)
    if style_codes:
        return f"{domain}:style:{style_codes[-1]}"
    route = re.search(r"/(?:products?|prd)/([^/?#]+)", path)
    if route and route.group(1) not in GENERIC_PATH_SEGMENTS:
        return f"{domain}:handle:{route.group(1)}"
    segments = [s for s in path.split("/") if s and s not in GENERIC_PATH_SEGMENTS]
    tail = "/".join(segments[-3:]) or path or url
    return f"{domain}:path:{tail}"


def status_from_row(row: dict[str, str]) -> str:
    availability = (row.get("availability") or "").lower()
    verification = (row.get("verification_status") or "").lower()
    source = (row.get("source") or "").lower()
    http_status = str(row.get("http_status") or "")
    if availability == "outofstock":
        return "out_of_stock"
    if availability == "instock":
        return "active"
    if source in {"sitemap", "sitemap_index", "official_sitemap"}:
        return "sitemap_only"
    if http_status in {"404", "410"}:
        return "removed"
    if "blocked" in verification or http_status in {"401", "403", "429"}:
        return "blocked"
    if verification in {"verified_product", "strong_candidate"}:
        return "unknown"
    return "unknown"


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_root", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    captured = read_csvs(args.input_root, {
        "fred_perry_product_urls_all.csv",
        "fred_perry_product_urls_all_observed.csv",
        "official_fred_perry_product_urls.csv",
        "strict_product_urls.csv",
    })
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # Deduplicate exact retailer product identities, not across retailers. Cross-store product
    # resolution is a later evidence-based stage because names alone are insufficient.
    by_key: dict[tuple[str, str], dict[str, str]] = {}
    source_urls: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in captured:
        url = normalize_url(row.get("product_url") or row.get("url") or row.get("canonical_url") or "")
        if not url:
            continue
        domain = (row.get("domain") or urllib.parse.urlsplit(url).netloc).lower().removeprefix("www.")
        identity = identity_from_url(domain, url, row.get("product_identity", ""))
        key = (domain, identity)
        source_urls[key].add(url)
        current = by_key.get(key)
        if current is None:
            row = dict(row)
            row["_normalized_url"] = url
            row["_domain"] = domain
            row["_identity"] = identity
            by_key[key] = row
        else:
            # Prefer a row carrying more direct metadata, but retain every source URL separately.
            score = sum(bool(row.get(k)) for k in ("product_name", "canonical_url", "availability", "http_status"))
            old_score = sum(bool(current.get(k)) for k in ("product_name", "canonical_url", "availability", "http_status"))
            if score > old_score:
                row = dict(row)
                row["_normalized_url"] = url
                row["_domain"] = domain
                row["_identity"] = identity
                by_key[key] = row

    product_rows: list[dict[str, object]] = []
    research_rows: list[dict[str, object]] = []
    image_rows: list[dict[str, object]] = []
    source_map_rows: list[dict[str, object]] = []

    for index, ((domain, identity), row) in enumerate(sorted(by_key.items()), start=1):
        seed_hash = hashlib.sha256(f"{domain}|{identity}".encode()).hexdigest()[:16]
        seed_id = f"FP-KB-SEED-{seed_hash.upper()}"
        preferred_url = row.get("_normalized_url", "")
        source_sha = hashlib.sha256(preferred_url.encode()).hexdigest()
        product = {
            "kb_product_seed_id": seed_id,
            "retailer_rank": row.get("rank", ""),
            "store": row.get("store", ""),
            "domain": domain,
            "product_identity": identity,
            "source_url": preferred_url,
            "canonical_url": normalize_url(row.get("canonical_url", "")),
            "source_status": status_from_row(row),
            "source_method": row.get("source", ""),
            "http_status": row.get("http_status", ""),
            "product_name_raw": row.get("product_name", ""),
            "model_name_normalized": "",
            "style_code": "",
            "colour_name_official": "",
            "colour_code": "",
            "colour_visual_normalized": "",
            "year_exact": "",
            "season": "",
            "year_from": "",
            "year_to": "",
            "dating_basis": "",
            "factory_name": "",
            "factory_country": "",
            "manufacturer_legal_entity": "",
            "material_outer": "",
            "material_lining": "",
            "material_trim": "",
            "care_instructions_raw": "",
            "product_category": "",
            "gender_marketing": "",
            "evidence_grade": "",
            "completeness_state": "URL_ONLY",
            "captured_at_utc": row.get("captured_at_utc") or now,
            "source_sha256": source_sha,
        }
        product_rows.append(product)

        for area, priority, evidence in RESEARCH_AREAS:
            research_rows.append({
                "kb_product_seed_id": seed_id,
                "research_area": area,
                "priority": priority,
                "current_value": "",
                "required_evidence": evidence,
                "status": "OPEN",
                "source_url": preferred_url,
                "notes": "",
            })

        for role, required in IMAGE_ROLES:
            image_rows.append({
                "kb_product_seed_id": seed_id,
                "image_role": role,
                "required": "YES" if required else "NO",
                "source_image_url": "",
                "referring_page_url": preferred_url,
                "original_filename": "",
                "mime_type": "",
                "width_px": "",
                "height_px": "",
                "sha256_bytes": "",
                "perceptual_hash": "",
                "original_path": "",
                "normalized_path": "",
                "evidence_grade": "",
                "status": "OPEN",
                "notes": "No placeholder image. Fill only after downloading real source evidence.",
            })

        for url in sorted(source_urls[(domain, identity)]):
            source_map_rows.append({
                "kb_product_seed_id": seed_id,
                "domain": domain,
                "product_identity": identity,
                "source_url": url,
                "sha256_url": hashlib.sha256(url.encode()).hexdigest(),
            })

    out = args.output_dir
    write_csv(out / "kb_product_seed.csv", product_rows, PRODUCT_FIELDS)
    write_csv(out / "kb_field_research_queue.csv", research_rows, RESEARCH_FIELDS)
    write_csv(out / "kb_image_evidence_queue.csv", image_rows, IMAGE_FIELDS)
    write_csv(out / "kb_product_source_urls.csv", source_map_rows,
              ["kb_product_seed_id", "domain", "product_identity", "source_url", "sha256_url"])

    manifest = {
        "schema": "RLF_FRED_PERRY_KB_ENRICHMENT_QUEUE_V1",
        "created_at_utc": now,
        "kb_product_seeds": len(product_rows),
        "source_urls_retained": len(source_map_rows),
        "field_research_tasks": len(research_rows),
        "image_evidence_slots": len(image_rows),
        "image_roles_per_seed": len(IMAGE_ROLES),
        "commercial_pool_filters_applied": False,
        "availability_is_exclusion_filter": False,
        "guardrails": [
            "No fabricated product fields",
            "No generated or placeholder images",
            "All product-page URLs retained irrespective of sale status",
            "Category/search/blog URLs remain excluded",
            "Factory identity requires direct or bridged evidence",
            "Manufacturing year is never inferred from listing date",
        ],
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
