#!/usr/bin/env python3
"""Combine per-retailer Fred Perry URL maps into a strict active-sale package.

No URL is generated. Every retained URL was captured by a retailer worker.
The final package separates active/current products, out-of-stock products and
unresolved candidates, and deduplicates locale copies by retailer product ID.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PRODUCT_FIELDS = [
    "rank", "store", "domain", "product_identity", "product_url", "canonical_url",
    "product_name", "http_status", "verification_status", "availability", "map_bucket",
    "source", "source_url", "sha256_url", "captured_at_utc",
]

SUMMARY_FIELDS = [
    "rank", "store", "domain", "active_unique_products", "active_verified_instock",
    "active_availability_unknown", "outofstock_unique_products", "unresolved_candidates",
    "observed_rows_before_identity_dedupe", "duplicate_locale_or_route_rows_removed",
    "coverage_status", "captured_at_utc",
]

DIRECT_SOURCES = {
    "shopify_api", "woocommerce_api", "jsonld", "rendered_jsonld",
    "brand_page", "rendered_brand_page",
}

GENERIC_SEGMENTS = {
    "men", "women", "kids", "sale", "outlet", "brand", "brands", "collections",
    "collection", "product", "products", "fred-perry", "fredperry", "en", "de", "fr",
    "es", "it", "nl", "be", "at", "ch", "uk", "eu", "au", "us", "pt", "pl",
}


def read_csvs(root: Path, filename: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for path in sorted(root.rglob(filename)):
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            rows.extend(csv.DictReader(f))
    return rows


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def normalize_captured_url(url: str) -> str:
    if not url:
        return ""
    p = urllib.parse.urlsplit(url.strip())
    keep = []
    for key, value in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        kl = key.lower()
        if kl.startswith("utm_") or kl in {"gclid", "fbclid", "srsltid", "ref", "source"}:
            continue
        keep.append((key, value))
    path = re.sub(r"/{2,}", "/", p.path or "/")
    return urllib.parse.urlunsplit((p.scheme or "https", p.netloc.lower(), path, urllib.parse.urlencode(keep), ""))


def same_domain(url: str, domain: str) -> bool:
    host = urllib.parse.urlsplit(url).netloc.lower().removeprefix("www.")
    target = (domain or "").lower().removeprefix("www.")
    return bool(host and target and (host == target or host.endswith("." + target)))


def product_identity(row: dict[str, str]) -> str:
    """Derive a stable identity from a captured URL without constructing a URL."""
    domain = (row.get("domain") or "").lower().removeprefix("www.")
    raw = row.get("canonical_url") or row.get("product_url") or ""
    if not same_domain(raw, row.get("domain", "")):
        raw = row.get("product_url") or raw
    url = normalize_captured_url(raw)
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.unquote(p.path).lower().rstrip("/")
    query = dict(urllib.parse.parse_qsl(p.query))

    for key in ("productid", "product_id", "pid", "sku", "style"):
        if query.get(key):
            return f"{domain}:q:{key}:{query[key].lower()}"

    explicit_patterns = (
        r"/prd/(\d+)(?:/|$)",
        r"/style/([a-z0-9-]+)(?:/|$)",
        r"/(\d{7,})/p(?:/|$)",
        r"/p/[^/]+/(\d{6,})(?:/|$)",
        r"/(?:product|products)/[^?#]*/(\d{5,})(?:/|$)",
    )
    for pattern in explicit_patterns:
        match = re.search(pattern, path)
        if match:
            return f"{domain}:id:{match.group(1)}"

    numeric_segments = re.findall(r"(?<![a-z])(\d{6,})(?![a-z])", path)
    if numeric_segments:
        return f"{domain}:num:{numeric_segments[-1]}"

    # Fred Perry style/colour codes, e.g. M3600-350 or SJ2115-102.
    style_codes = re.findall(r"(?<![a-z0-9])([a-z]{1,5}\d{3,7}(?:-\d{2,4})?)(?![a-z0-9])", path)
    if style_codes:
        return f"{domain}:style:{style_codes[-1]}"

    # Shopify/WooCommerce and other explicit product route handles.
    route_match = re.search(r"/(?:products?|prd)/([^/?#]+)", path)
    if route_match:
        handle = route_match.group(1).strip("-_")
        if handle and handle not in GENERIC_SEGMENTS:
            return f"{domain}:handle:{handle}"

    segments = [s for s in path.split("/") if s and s not in GENERIC_SEGMENTS]
    # Remove common locale prefixes and terminal technical markers.
    segments = [s for s in segments if not re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", s)]
    if segments and segments[-1] in {"p", "html"}:
        segments.pop()
    tail = "/".join(segments[-3:]) or path or url
    return f"{domain}:path:{tail}"


def verification_strength(row: dict[str, str]) -> int:
    status = row.get("verification_status", "")
    availability = row.get("availability", "")
    source = row.get("source", "")
    score = {
        "verified_product": 50,
        "strong_candidate": 40,
        "blocked_unverified": 20,
        "unverified_candidate": 15,
        "request_error": 10,
    }.get(status, 0)
    if availability == "instock":
        score += 30
    elif availability == "outofstock":
        score -= 30
    if source in DIRECT_SOURCES:
        score += 8
    if str(row.get("http_status", "")) == "200":
        score += 5
    return score


def url_preference(row: dict[str, str]) -> tuple[int, int, int, str]:
    url = row.get("product_url", "")
    path = urllib.parse.urlsplit(url).path
    # Prefer active, stronger evidence, and shorter non-locale routes.
    locale_penalty = len(re.findall(r"/(?:[a-z]{2})(?:/|-[a-z]{2}/)", path.lower()))
    return (
        verification_strength(row),
        -locale_penalty,
        -len(path),
        url,
    )


def map_bucket(row: dict[str, str]) -> str:
    status = row.get("verification_status", "")
    availability = row.get("availability", "")
    source = row.get("source", "")
    if availability == "outofstock":
        return "outofstock"
    if availability == "instock" and status in {"verified_product", "strong_candidate"}:
        return "active"
    if status in {"verified_product", "strong_candidate"} and source in DIRECT_SOURCES:
        return "active_unknown_availability"
    return "unresolved"


def choose_unique(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    by_identity: dict[tuple[str, str], dict[str, str]] = {}
    for original in rows:
        row = dict(original)
        row["product_url"] = normalize_captured_url(row.get("product_url", ""))
        row["canonical_url"] = normalize_captured_url(row.get("canonical_url", ""))
        identity = product_identity(row)
        row["product_identity"] = identity
        row["map_bucket"] = map_bucket(row)
        key = (row.get("domain", ""), identity)
        old = by_identity.get(key)
        if old is None or url_preference(row) > url_preference(old):
            by_identity[key] = row
    unique = list(by_identity.values())
    return unique, max(0, len(rows) - len(unique))


def sort_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(rows, key=lambda r: (
        int(r.get("rank") or 999),
        r.get("store", ""),
        r.get("product_name", "").lower(),
        r.get("product_url", ""),
    ))


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: combine_fred_perry_product_maps.py INPUT_ROOT OUTPUT_DIR")
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    observed_raw = read_csvs(src, "fred_perry_product_urls_all.csv")
    rejected_raw = read_csvs(src, "fred_perry_product_urls_rejected.csv")
    logs = read_csvs(src, "fred_perry_discovery_log.csv")

    observed, removed_duplicates = choose_unique(observed_raw)
    rejected, _ = choose_unique(rejected_raw)

    active = sort_rows([r for r in observed if r["map_bucket"] in {"active", "active_unknown_availability"}])
    outofstock = sort_rows([r for r in observed if r["map_bucket"] == "outofstock"])
    unresolved = sort_rows([r for r in observed if r["map_bucket"] == "unresolved"] + rejected)
    observed = sort_rows(observed)

    # Recompute retailer summary from the strict unique-product buckets.
    stores: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    raw_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for row in observed_raw:
        key = (row.get("rank", ""), row.get("store", ""), row.get("domain", ""))
        raw_counts[key] += 1
    for row in observed:
        key = (row.get("rank", ""), row.get("store", ""), row.get("domain", ""))
        stores[key].append(row)
    # Include stores that returned zero retained rows via the original summaries.
    for summary in read_csvs(src, "fred_perry_product_url_summary.csv"):
        stores.setdefault((summary.get("rank", ""), summary.get("store", ""), summary.get("domain", "")), [])

    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    summaries: list[dict[str, str | int]] = []
    for key, rows in sorted(stores.items(), key=lambda item: int(item[0][0] or 999)):
        rank, store, domain = key
        active_rows = [r for r in rows if r["map_bucket"] in {"active", "active_unknown_availability"}]
        in_stock = [r for r in active_rows if r.get("availability") == "instock"]
        active_unknown = [r for r in active_rows if r.get("availability") != "instock"]
        out_rows = [r for r in rows if r["map_bucket"] == "outofstock"]
        unresolved_rows = [r for r in rows if r["map_bucket"] == "unresolved"]
        raw_count = raw_counts.get(key, 0)
        duplicate_count = max(0, raw_count - len(rows))
        if in_stock and not active_unknown:
            coverage = "active_verified"
        elif active_rows:
            coverage = "active_plus_unknown_availability"
        elif unresolved_rows:
            coverage = "unresolved_or_blocked"
        else:
            coverage = "zero_active_found"
        summaries.append({
            "rank": rank,
            "store": store,
            "domain": domain,
            "active_unique_products": len(active_rows),
            "active_verified_instock": len(in_stock),
            "active_availability_unknown": len(active_unknown),
            "outofstock_unique_products": len(out_rows),
            "unresolved_candidates": len(unresolved_rows),
            "observed_rows_before_identity_dedupe": raw_count,
            "duplicate_locale_or_route_rows_removed": duplicate_count,
            "coverage_status": coverage,
            "captured_at_utc": captured_at,
        })

    write_csv(out / "fred_perry_product_urls_all.csv", active, PRODUCT_FIELDS)
    write_csv(out / "fred_perry_product_urls_active.csv", active, PRODUCT_FIELDS)
    write_csv(out / "fred_perry_product_urls_all_observed.csv", observed, PRODUCT_FIELDS)
    write_csv(out / "fred_perry_product_urls_outofstock.csv", outofstock, PRODUCT_FIELDS)
    write_csv(out / "fred_perry_product_urls_unresolved.csv", unresolved, PRODUCT_FIELDS)
    write_csv(out / "fred_perry_product_url_summary.csv", summaries, SUMMARY_FIELDS)
    write_csv(out / "fred_perry_discovery_log.csv", logs, ["store", "method", "url", "status", "detail"])

    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in active:
        grouped[(row.get("rank", ""), row.get("store", ""), row.get("domain", ""))].append(row)
    per_store = out / "per_store"
    for summary in summaries:
        rank = str(summary["rank"])
        store = str(summary["store"])
        domain = str(summary["domain"])
        rows = grouped.get((rank, store, domain), [])
        slug = re.sub(r"[^a-z0-9]+", "_", store.lower()).strip("_")
        prefix = f"{int(rank):02d}_{slug}"
        write_csv(per_store / f"{prefix}.csv", rows, PRODUCT_FIELDS)
        (per_store / f"{prefix}_urls.txt").write_text(
            "".join((row.get("product_url") or "") + "\n" for row in rows), encoding="utf-8"
        )

    status_counts: dict[str, int] = defaultdict(int)
    bucket_counts: dict[str, int] = defaultdict(int)
    for row in observed:
        status_counts[row.get("verification_status", "unknown")] += 1
        bucket_counts[row.get("map_bucket", "unknown")] += 1

    manifest = {
        "schema": "RLF_FRED_PERRY_PRODUCT_URL_MAP_V2_STRICT_ACTIVE",
        "combined_at_utc": captured_at,
        "retailers": len(summaries),
        "active_unique_product_urls": len(active),
        "active_verified_instock": sum(r.get("availability") == "instock" for r in active),
        "active_unknown_availability": sum(r.get("availability") != "instock" for r in active),
        "outofstock_unique_products": len(outofstock),
        "unresolved_candidates": len(unresolved),
        "observed_rows_before_identity_dedupe": len(observed_raw),
        "duplicate_locale_or_route_rows_removed": removed_duplicates,
        "status_counts": dict(sorted(status_counts.items())),
        "bucket_counts": dict(sorted(bucket_counts.items())),
        "guardrails": [
            "No fabricated URLs",
            "Every retained URL was captured from a public retailer source",
            "The main map excludes products explicitly marked out of stock",
            "Locale and route copies are deduplicated by retailer product identity",
            "Unknown availability remains explicitly labelled",
            "Rejected and unresolved candidates are retained outside the active map",
        ],
        "summary": summaries,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "README.md").write_text(
        "# Fred Perry product URL map — strict active-sale capture\n\n"
        "`fred_perry_product_urls_all.csv` and `fred_perry_product_urls_active.csv` are the main maps. "
        "They exclude URLs explicitly detected as out of stock and deduplicate country/language copies "
        "by retailer product identity. `availability=unknown` is not presented as verified stock: it is "
        "retained only when a live brand page, public commerce endpoint or product structured data gives "
        "strong direct evidence. Separate files preserve out-of-stock, unresolved and all-observed rows.\n",
        encoding="utf-8",
    )

    # File-level integrity for the unzipped final directory; the workflow also hashes the final ZIP.
    checksums = []
    for path in sorted(p for p in out.rglob("*") if p.is_file() and p.name != "SHA256SUMS.txt"):
        checksums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(out).as_posix()}")
    (out / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")

    print(json.dumps({
        "stores": len(summaries),
        "active": len(active),
        "outofstock": len(outofstock),
        "unresolved": len(unresolved),
        "dedupe_removed": removed_duplicates,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
