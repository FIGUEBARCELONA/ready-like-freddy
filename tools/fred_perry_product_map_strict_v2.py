#!/usr/bin/env python3
"""Second strict policy layer: force rendered discovery before sitemap fallback."""
from __future__ import annotations

import urllib.parse

import fred_perry_product_map_strict as strict

SITES = strict.SITES
_V1_STRICT_PRODUCT_PATH = strict.strict_product_path

_CATEGORY_SEGMENTS = {
    "male", "female", "men", "mens", "women", "womens", "kids", "junior",
    "clothing", "footwear", "accessories", "all", "new", "sale", "outlet",
    "shirts", "t-shirts", "polos", "jackets", "sweatshirts", "trainers",
}

_RENDERED_SOURCES = {"rendered_jsonld", "rendered_brand_page"}


def strict_product_path(url, site):
    if not _V1_STRICT_PRODUCT_PATH(url, site):
        return False
    path = urllib.parse.urlsplit(url).path.lower().rstrip("/")
    last = path.rsplit("/", 1)[-1]
    if last in _CATEGORY_SEGMENTS:
        return False
    # Working Class Heroes exposes gender/category routes beneath the brand slug.
    if site.rank == 5 and path in {
        "/fred-perry/male", "/fred-perry/female", "/fred-perry/mens",
        "/fred-perry/womens", "/brands/fred-perry/male", "/brands/fred-perry/female",
    }:
        return False
    return True


def merge_candidates(groups, site):
    """Use direct evidence first and force Selenium when direct discovery is thin."""
    groups = [list(group) for group in groups]
    direct_groups = [
        [candidate for candidate in group if candidate.source in strict._DIRECT_SOURCES]
        for group in groups
    ]
    direct = strict._original_merge_candidates(direct_groups, site)
    has_rendered_attempt = any(
        candidate.source in _RENDERED_SOURCES
        for group in groups
        for candidate in group
    )

    if len(direct) >= 20:
        return [c for c in direct if strict_product_path(c.url, site)][:site.max_candidates]

    # First merge occurs before Selenium. Return only thin direct evidence so the
    # base orchestrator invokes the rendered-browser fallback.
    if not has_rendered_attempt:
        return [c for c in direct if strict_product_path(c.url, site)][:site.max_candidates]

    # After a rendered attempt, supplement only with URL-shape-valid candidates.
    combined = strict._original_merge_candidates(groups, site)
    return [c for c in combined if strict_product_path(c.url, site)][:site.max_candidates]


def set_sites(sites) -> None:
    global SITES
    SITES = tuple(sites)
    strict.set_sites(SITES)


def install() -> None:
    strict.strict_product_path = strict_product_path
    strict.merge_candidates = merge_candidates
    strict.install()


def main() -> int:
    install()
    return strict.base.main()
