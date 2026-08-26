#!/usr/bin/env python3
"""Run the Fred Perry URL mapper for exactly one configured retailer."""
from __future__ import annotations

import argparse
import sys

import fred_perry_product_map as mapper


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-rank", type=int, required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    selected = tuple(site for site in mapper.SITES if site.rank == args.site_rank)
    if len(selected) != 1:
        raise SystemExit(f"Unknown or duplicate site rank: {args.site_rank}")

    mapper.SITES = selected
    sys.argv = [
        "fred_perry_product_map.py",
        "--output-dir", args.output_dir,
        "--workers", str(args.workers),
    ]
    return mapper.main()


if __name__ == "__main__":
    raise SystemExit(main())
