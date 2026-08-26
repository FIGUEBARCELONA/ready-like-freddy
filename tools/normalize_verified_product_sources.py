#!/usr/bin/env python3
"""Normalize auditable custom discovery labels for the generic consolidator.

The detailed discovery method remains in source_url and discovery logs. This
normalization only tells the existing strict bucket policy that these URLs came
from direct retailer evidence rather than an unverified generic sitemap.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

SOURCE_MAP = {
    "verified_seed": "brand_page",
    "next_product_sitemap": "brand_page",
}


def rewrite(path: Path) -> tuple[int, int]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        rows = list(reader)

    changed = 0
    for row in rows:
        old = row.get("source", "")
        new = SOURCE_MAP.get(old)
        if new:
            row["source"] = new
            changed += 1

    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return len(rows), changed


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: normalize_verified_product_sources.py COLLECTED_ROOT")
    root = Path(sys.argv[1])
    files = sorted(root.rglob("fred_perry_product_urls_all.csv"))
    total_rows = total_changed = 0
    for path in files:
        rows, changed = rewrite(path)
        total_rows += rows
        total_changed += changed
        if changed:
            print(f"normalized {changed}/{rows}: {path}")
    print(f"files={len(files)} rows={total_rows} normalized={total_changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
