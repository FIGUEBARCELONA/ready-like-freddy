#!/usr/bin/env python3
"""Strict fail-closed policy layer for the Fred Perry product URL mapper.

Only directly evidenced product URLs are promoted. Sitemap data is used as a
fallback when a retailer's live brand page/API does not expose a usable product
set. URLs are never fabricated.
"""
from __future__ import annotations

import re
import urllib.parse
from pathlib import Path

import fred_perry_product_map as base

SITES = base.SITES

_DIRECT_SOURCES = {
    "shopify_api",
    "woocommerce_api",
    "jsonld",
    "rendered_jsonld",
    "brand_page",
    "rendered_brand_page",
    "verified_seed",
    "next_product_sitemap",
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

_REPO_ROOT = Path(__file__).resolve().parents[1]
_JD_SEED = _REPO_ROOT / "data" / "fred_perry_product_url_seeds" / "jd_sports_uk_2026-08-26.txt"


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
_original_html_crawl = base.html_crawl
_original_validate_candidate = base.validate_candidate
_original_merge_candidates = base.merge_candidates


def _next_sitemap_candidates(session, site):
    """Extract Next products whose XML metadata explicitly names Fred Perry.

    Next product URLs do not necessarily contain the brand name, so filtering only
    the <loc> string produces false zero coverage. We restrict capture to the GB-EN
    product sitemap family and require Fred Perry in the complete <url> element.
    """
    out = []
    logs = []
    seen = set()
    order = 0
    empty_or_missing_streak = 0

    # Current Next index exposes numbered GB-EN product sitemap files. Iterate the
    # bounded family only; do not crawl duplicate Crown Dependency/localised sets.
    for number in range(1, 81):
        sitemap_url = f"https://www.next.co.uk/Next-GB-EN-Products-{number}.xml.gz"
        resp = base.get(session, sitemap_url, 35)
        if not resp or resp.status_code >= 400:
            logs.append({
                "store": site.store,
                "method": "next_product_sitemap",
                "url": sitemap_url,
                "status": getattr(resp, "status_code", "request_error"),
                "detail": "unavailable",
            })
            empty_or_missing_streak += 1
            if number > 60 and empty_or_missing_streak >= 5:
                break
            continue

        empty_or_missing_streak = 0
        content = base.decode_xml_content(resp, sitemap_url)
        try:
            root = base.ET.fromstring(content)
        except base.ET.ParseError:
            logs.append({
                "store": site.store,
                "method": "next_product_sitemap",
                "url": sitemap_url,
                "status": resp.status_code,
                "detail": "invalid_xml",
            })
            continue

        matched_here = 0
        entries = 0
        for node in root.iter():
            if not node.tag.lower().endswith("url"):
                continue
            entries += 1
            loc = ""
            text_parts = []
            title_hint = ""
            for child in node.iter():
                if child.text:
                    value = child.text.strip()
                    text_parts.append(value)
                    tag = child.tag.lower()
                    if tag.endswith("loc") and not loc:
                        loc = value
                    if (tag.endswith("title") or tag.endswith("caption")) and base.BRAND_RE.search(value):
                        title_hint = value
            if not loc or not base.BRAND_RE.search(" ".join(text_parts)):
                continue
            url = base.normalize_url(loc)
            if not url or not base.same_site(url, site) or not strict_product_path(url, site):
                continue
            if url in seen:
                continue
            seen.add(url)
            order += 1
            matched_here += 1
            out.append(base.Candidate(
                site.rank,
                site.store,
                site.domain,
                url,
                "next_product_sitemap",
                sitemap_url,
                title_hint,
                order,
            ))
            if len(out) >= site.max_candidates:
                break

        logs.append({
            "store": site.store,
            "method": "next_product_sitemap",
            "url": sitemap_url,
            "status": resp.status_code,
            "detail": f"entries:{entries} fred_perry:{matched_here}",
        })
        if len(out) >= site.max_candidates:
            break

    return out, logs


def sitemap_candidates(session, site):
    if site.rank == 9:
        return _next_sitemap_candidates(session, site)

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


def _verified_seed_candidates(site, seed_path: Path, source_url: str):
    candidates = []
    logs = []
    if not seed_path.exists():
        return candidates, [{
            "store": site.store,
            "method": "verified_seed",
            "url": str(seed_path),
            "status": "missing",
            "detail": "seed_file_not_found",
        }]

    seen = set()
    order = 0
    for raw in seed_path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        url = base.normalize_url(raw)
        if not url or not base.same_site(url, site) or not strict_product_path(url, site):
            continue
        if url in seen:
            continue
        seen.add(url)
        order += 1
        candidates.append(base.Candidate(
            site.rank,
            site.store,
            site.domain,
            url,
            "verified_seed",
            source_url,
            "Fred Perry product linked from retailer brand page",
            order,
        ))

    logs.append({
        "store": site.store,
        "method": "verified_seed",
        "url": source_url,
        "status": "ok",
        "detail": f"products:{len(candidates)} file:{seed_path.name}",
    })
    return candidates, logs


def html_crawl(session, site):
    candidates, logs = _original_html_crawl(session, site)
    if site.rank == 24:
        seeded, seed_logs = _verified_seed_candidates(
            site,
            _JD_SEED,
            "https://www.jdsports.co.uk/brand/fred-perry/",
        )
        candidates.extend(seeded)
        logs.extend(seed_logs)
    return candidates, logs


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

    # Direct product links from a live brand page, API, verified seed or branded
    # product sitemap remain strong evidence when the detail page blocks validation.
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
    base.html_crawl = html_crawl
    base.merge_candidates = merge_candidates
    base.validate_candidate = validate_candidate


def main() -> int:
    install()
    base.SITES = SITES
    return base.main()
