#!/usr/bin/env python3
"""Strict fail-closed policy layer for the Fred Perry product URL mapper.

Only directly evidenced product URLs are promoted. Sitemap data is used as a
fallback when a retailer's live brand page/API does not expose a usable product
set. URLs are never fabricated.
"""
from __future__ import annotations

import re
import urllib.parse

import fred_perry_product_map as base

SITES = base.SITES

_DIRECT_SOURCES = {
    "shopify_api",
    "woocommerce_api",
    "jsonld",
    "rendered_jsonld",
    "brand_page",
    "rendered_brand_page",
}

_CATEGORY_TAILS = {
    "fred-perry",
    "fredperry",
    "brand/fred-perry",
    "brands/fred-perry",
    "collections/fred-perry",
    "collections/fred-perry-1",
}

_OFFICIAL_STYLE_URL = re.compile(
    r"(?<![a-z0-9])([a-z]{1,5}\d{3,7}(?:-[a-z0-9]{2,4})?)\.html$",
    re.I,
)


def _path(url: str) -> str:
    return urllib.parse.urlsplit(url).path.lower().rstrip("/")


def strict_product_path(url: str, site: base.Site) -> bool:
    """Return True only when the retailer-specific URL shape is product-like."""
    path = _path(url)
    if not path or path == "/":
        return False

    if any(token in path for token in (
        "/about", "/privacy", "/terms", "/cookies", "/search", "/help",
        "/customer-service", "/delivery", "/returns", "/stores", "/blog",
        "/category/", "/product-category/brands/fred-perry",
    )):
        return False
    if path.lstrip("/") in _CATEGORY_TAILS:
        return False

    rank = site.rank
    if rank == 1:
        # Authoritative Fred Perry product URLs end in a style/colour code.
        return bool(_OFFICIAL_STYLE_URL.search(path))
    if rank == 4:
        return "/fred-perry/" in path and "/prd/" in path
    if rank == 8:
        return "/p/" in path and "fred-perry" in path
    if rank == 9:
        return "/style/" in path
    if rank in {11, 22, 25}:
        return "/products/" in path
    if rank == 14:
        return "/product/" in path
    if rank == 16:
        return path.endswith(".html") and "fred-perry" in path
    if rank in {13, 24}:
        return "/product/" in path and "fred" in path

    # Sports Direct group and similar catalogues use brand slug + numeric SKU.
    if rank in {6, 7, 12, 17, 20}:
        return "fred-perry" in path and bool(re.search(r"\d{5,}", path))

    if "/product/" in path or "/products/" in path:
        return "fred" in path
    if "fred-perry" not in path and "fredperry" not in path:
        return False
    tail = re.split(r"fred-?perry", path, maxsplit=1)[-1].strip("/-_")
    return len(tail) >= 4 and bool(re.search(r"[a-z]", tail))


_original_sitemap_candidates = base.sitemap_candidates
_original_validate_candidate = base.validate_candidate
_original_merge_candidates = base.merge_candidates


def sitemap_candidates(session, site):
    candidates, logs = _original_sitemap_candidates(session, site)
    kept = [c for c in candidates if strict_product_path(c.url, site)]
    logs.append({
        "store": site.store,
        "method": "strict_sitemap_filter",
        "url": "",
        "status": "ok",
        "detail": f"input:{len(candidates)} kept:{len(kept)} rejected:{len(candidates)-len(kept)}",
    })
    return kept, logs


def merge_candidates(groups, site):
    """Prefer live catalogue/API evidence; sitemap is fallback/supplement only."""
    groups = [list(group) for group in groups]
    direct_groups = [
        [candidate for candidate in group if candidate.source in _DIRECT_SOURCES]
        for group in groups
    ]
    direct = _original_merge_candidates(direct_groups, site)

    # A live catalogue with >=20 unique product links is materially stronger than
    # a bulk sitemap that often contains locale copies and historic products.
    if len(direct) >= 20:
        return direct[:site.max_candidates]

    combined = _original_merge_candidates(groups, site)
    return [candidate for candidate in combined if strict_product_path(candidate.url, site)][:site.max_candidates]


def validate_candidate(candidate, site_by_domain):
    site = site_by_domain[candidate.domain]
    row = _original_validate_candidate(candidate, site_by_domain)

    if row.verification_status in {"verified_product", "strong_candidate"}:
        return row

    # Direct product links from a live brand page/API remain strong evidence when
    # a detail page blocks the validator.
    if (
        row.verification_status in {"blocked_unverified", "request_error", "unverified_candidate"}
        and candidate.source in _DIRECT_SOURCES
        and strict_product_path(candidate.url, site)
    ):
        row.verification_status = "strong_candidate"
        return row

    # The official brand sitemap plus an encoded style/colour product URL is
    # authoritative route evidence, but availability stays explicitly unknown.
    if (
        site.rank == 1
        and candidate.source == "sitemap"
        and strict_product_path(candidate.url, site)
        and row.verification_status in {"blocked_unverified", "request_error", "unverified_candidate"}
    ):
        row.verification_status = "strong_candidate"
        return row

    if row.verification_status in {"blocked_unverified", "request_error", "unverified_candidate"}:
        row.verification_status = "rejected_unverified"
    return row


def set_sites(sites) -> None:
    global SITES
    SITES = tuple(sites)
    base.SITES = SITES


def install() -> None:
    base.sitemap_candidates = sitemap_candidates
    base.merge_candidates = merge_candidates
    base.validate_candidate = validate_candidate


def main() -> int:
    install()
    base.SITES = SITES
    return base.main()
