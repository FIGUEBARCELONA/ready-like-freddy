#!/usr/bin/env python3
"""Combine per-retailer Fred Perry URL map artifacts into one auditable package."""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


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


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: combine_fred_perry_product_maps.py INPUT_ROOT OUTPUT_DIR")
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    products = read_csvs(src, "fred_perry_product_urls_all.csv")
    rejected = read_csvs(src, "fred_perry_product_urls_rejected.csv")
    summaries = read_csvs(src, "fred_perry_product_url_summary.csv")
    logs = read_csvs(src, "fred_perry_discovery_log.csv")

    # Exact global deduplication by retailer domain plus canonical/product URL.
    by_key: dict[tuple[str, str], dict[str, str]] = {}
    strength = {
        "verified_product": 5,
        "strong_candidate": 4,
        "blocked_unverified": 3,
        "unverified_candidate": 2,
        "request_error": 1,
    }
    for row in products:
        url = row.get("canonical_url") or row.get("product_url") or ""
        key = (row.get("domain", ""), url)
        old = by_key.get(key)
        if old is None or strength.get(row.get("verification_status", ""), 0) > strength.get(old.get("verification_status", ""), 0):
            by_key[key] = row
    products = sorted(by_key.values(), key=lambda r: (int(r.get("rank") or 999), r.get("store", ""), r.get("product_name", "").lower(), r.get("product_url", "")))
    rejected = sorted(rejected, key=lambda r: (int(r.get("rank") or 999), r.get("product_url", "")))
    summaries = sorted(summaries, key=lambda r: int(r.get("rank") or 999))

    product_fields = [
        "rank", "store", "domain", "product_url", "canonical_url", "product_name",
        "http_status", "verification_status", "availability", "source", "source_url",
        "sha256_url", "captured_at_utc",
    ]
    summary_fields = [
        "rank", "store", "domain", "product_urls_kept", "verified_product",
        "strong_candidate", "blocked_unverified", "request_error",
        "availability_instock", "availability_outofstock",
        "candidate_count_before_validation", "coverage_status", "captured_at_utc",
    ]
    log_fields = ["store", "method", "url", "status", "detail"]

    write_csv(out / "fred_perry_product_urls_all.csv", products, product_fields)
    write_csv(out / "fred_perry_product_urls_rejected.csv", rejected, product_fields)
    write_csv(out / "fred_perry_product_url_summary.csv", summaries, summary_fields)
    write_csv(out / "fred_perry_discovery_log.csv", logs, log_fields)

    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in products:
        grouped[(row.get("rank", ""), row.get("store", ""), row.get("domain", ""))].append(row)
    per_store = out / "per_store"
    for (rank, store, _domain), rows in sorted(grouped.items(), key=lambda item: int(item[0][0] or 999)):
        slug = re.sub(r"[^a-z0-9]+", "_", store.lower()).strip("_")
        prefix = f"{int(rank):02d}_{slug}"
        write_csv(per_store / f"{prefix}.csv", rows, product_fields)
        (per_store / f"{prefix}_urls.txt").write_text(
            "".join((row.get("product_url") or "") + "\n" for row in rows), encoding="utf-8"
        )

    status_counts: dict[str, int] = defaultdict(int)
    availability_counts: dict[str, int] = defaultdict(int)
    for row in products:
        status_counts[row.get("verification_status", "unknown")] += 1
        availability_counts[row.get("availability", "unknown")] += 1
    manifest = {
        "schema": "RLF_FRED_PERRY_PRODUCT_URL_MAP_V1_PARALLEL25",
        "combined_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "retailer_summaries_found": len(summaries),
        "unique_product_urls": len(products),
        "rejected_candidates": len(rejected),
        "status_counts": dict(sorted(status_counts.items())),
        "availability_counts": dict(sorted(availability_counts.items())),
        "guardrails": [
            "No fabricated URLs",
            "Every retained URL carries a discovery source",
            "Global deduplication by domain plus canonical URL",
            "Blocked and unresolved URLs remain explicitly labelled",
        ],
        "summary": summaries,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "README.md").write_text(
        "# Fred Perry product URL map — parallel 25-store capture\n\n"
        "This consolidated package contains one row per retained product URL, a retailer summary, "
        "per-store CSV/TXT files, rejected candidates, discovery logs and SHA-256 checksums. "
        "Use `verification_status`, `availability` and `coverage_status` when interpreting completeness.\n",
        encoding="utf-8",
    )
    print(json.dumps({"stores": len(summaries), "products": len(products), "rejected": len(rejected)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
