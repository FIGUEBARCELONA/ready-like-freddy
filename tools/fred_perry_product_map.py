#!/usr/bin/env python3
"""Build a reproducible map of current Fred Perry product URLs across 25 retailers.

The crawler is fail-closed: it never fabricates URLs. Candidates must come from a
retailer sitemap, a retailer brand/category page, a public commerce endpoint, or
rendered HTML. It records blocked and unresolved stores separately.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

UTC_NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
BRAND_RE = re.compile(r"fred[\s_\-]*perry", re.I)
BRAND_PATH_RE = re.compile(r"fred(?:-|_|%20|\s)*perry|fredperry", re.I)
PRODUCT_JSON_TYPES = {"product", "productgroup"}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
]


@dataclass(frozen=True)
class Site:
    rank: int
    store: str
    domain: str
    start_urls: tuple[str, ...]
    product_hints: tuple[str, ...] = ()
    max_pages: int = 60
    max_sitemap_files: int = 250
    max_candidates: int = 2500


SITES: tuple[Site, ...] = (
    Site(1, "Fred Perry official", "www.fredperry.com", (
        "https://www.fredperry.com/eu-en/men",
        "https://www.fredperry.com/eu-en/women",
        "https://www.fredperry.com/eu-en/kids",
        "https://www.fredperry.com/men",
        "https://www.fredperry.com/women",
    ), (".html", "/product/", "/products/"), 80, 400, 3000),
    Site(2, "Boozt", "www.boozt.com", (
        "https://www.boozt.com/eu/en/fred-perry",
        "https://www.boozt.com/eu/en/fred-perry/men",
        "https://www.boozt.com/eu/en/fred-perry/women",
        "https://www.boozt.com/eu/en/fred-perry/kids",
    ), ("/fred-perry/",), 80),
    Site(3, "Mainline Menswear", "www.mainlinemenswear.com", (
        "https://www.mainlinemenswear.com/fred-perry/",
    ), ("/product/", "/fred-perry-"), 80),
    Site(4, "ASOS", "www.asos.com", (
        "https://www.asos.com/men/a-to-z-of-brands/fred-perry/cat/?cid=4562",
        "https://www.asos.com/women/a-to-z-of-brands/fred-perry/cat/?cid=5651",
    ), ("/fred-perry/", "/prd/"), 80),
    Site(5, "Working Class Heroes", "www.workingclassheroes.co.uk", (
        "https://www.workingclassheroes.co.uk/fred-perry",
        "https://www.workingclassheroes.co.uk/brands/fred-perry",
    ), ("/products/", "/fred-perry-"), 80),
    Site(6, "Frasers", "www.frasers.com", (
        "https://www.frasers.com/fred-perry",
        "https://www.frasers.com/brand/fred-perry",
    ), ("fred-perry",), 80),
    Site(7, "Flannels", "www.flannels.com", (
        "https://www.flannels.com/fred-perry",
        "https://www.flannels.com/fred-perry/men",
        "https://www.flannels.com/fred-perry/women",
    ), ("fred-perry",), 80),
    Site(8, "Breuninger", "www.breuninger.com", (
        "https://www.breuninger.com/es/en/brands/fred-perry/",
        "https://www.breuninger.com/de/en/brands/fred-perry/",
    ), ("fred-perry", "/p/"), 80),
    Site(9, "Next", "www.next.co.uk", (
        "https://www.next.co.uk/brands/fred-perry",
    ), ("/style/", "fred-perry"), 100),
    Site(10, "PRM", "prm.com", (
        "https://prm.com/eu/m/fred-perry",
    ), ("fred-perry",), 80),
    Site(11, "EQVVS", "www.eqvvs.co.uk", (
        "https://www.eqvvs.co.uk/collections/fred-perry",
    ), ("/products/",), 80),
    Site(12, "House of Fraser", "www.houseoffraser.co.uk", (
        "https://www.houseoffraser.co.uk/brand/fred-perry",
        "https://www.houseoffraser.co.uk/fred-perry",
    ), ("fred-perry",), 80),
    Site(13, "Tessuti", "www.tessuti.co.uk", (
        "https://www.tessuti.co.uk/brand/fred-perry/",
        "https://www.tessuti.co.uk/men/brand/fred-perry/",
        "https://www.tessuti.co.uk/women/brand/fred-perry/",
    ), ("fred-perry", "/product/"), 80),
    Site(14, "The Cream Store", "thecreamstore.com", (
        "https://thecreamstore.com/product-category/brands/fred-perry/",
    ), ("/product/",), 80),
    Site(15, "Terraces Menswear", "www.terracesmenswear.co.uk", (
        "https://www.terracesmenswear.co.uk/Fred-Perry",
        "https://www.terracesmenswear.co.uk/fred-perry",
    ), ("fred-perry",), 80),
    Site(16, "Zalando Germany", "www.zalando.de", (
        "https://www.zalando.de/fred-perry/",
        "https://www.zalando.de/herrenbekleidung/fred-perry/",
        "https://www.zalando.de/damenbekleidung/fred-perry/",
    ), ("fred-perry", ".html"), 100, 300, 3000),
    Site(17, "USC", "www.usc.co.uk", (
        "https://www.usc.co.uk/fred-perry",
        "https://www.usc.co.uk/brand/fred-perry",
    ), ("fred-perry",), 80),
    Site(18, "Printemps", "www.printemps.com", (
        "https://www.printemps.com/uk/en/fredperry",
        "https://www.printemps.com/uk/en/fredperry-men",
        "https://www.printemps.com/uk/en/fredperry-women",
        "https://www.printemps.com/fr/en/fredperry",
    ), ("fred-perry", "fredperry"), 80),
    Site(19, "Suitable", "www.suitableshop.nl", (
        "https://www.suitableshop.nl/fred-perry/",
    ), ("fred-perry",), 80),
    Site(20, "Sports Direct", "www.sportsdirect.com", (
        "https://www.sportsdirect.com/fred-perry",
        "https://www.sportsdirect.com/brand/fred-perry",
    ), ("fred-perry",), 80),
    Site(21, "Mike's Outlet", "www.mikesoutlet.nl", (
        "https://www.mikesoutlet.nl/merken/fred-perry-outlet/",
        "https://www.mikesjustformen.nl/fred-perry/",
    ), ("fred-perry",), 80),
    Site(22, "Modfather Clothing", "modfatherclothing.com", (
        "https://modfatherclothing.com/collections/fred-perry-1",
        "https://modfatherclothing.com/collections/fred-perry",
    ), ("/products/",), 80),
    Site(23, "Care of Carl", "www.careofcarl.com", (
        "https://www.careofcarl.com/en/fred-perry",
        "https://www.careofcarl.co.uk/en/fred-perry",
    ), ("fred-perry",), 80),
    Site(24, "JD Sports UK", "www.jdsports.co.uk", (
        "https://www.jdsports.co.uk/brand/fred-perry/",
    ), ("fred-perry", "/product/"), 80),
    Site(25, "Stuarts London", "www.stuartslondon.com", (
        "https://www.stuartslondon.com/collections/fred-perry",
    ), ("/products/",), 80),
)


@dataclass
class Candidate:
    rank: int
    store: str
    domain: str
    url: str
    source: str
    source_url: str
    title_hint: str = ""
    discovery_order: int = 0


@dataclass
class ProductRow:
    rank: int
    store: str
    domain: str
    product_url: str
    canonical_url: str
    product_name: str
    http_status: int | str
    verification_status: str
    availability: str
    source: str
    source_url: str
    sha256_url: str
    captured_at_utc: str


def make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=3, connect=3, read=2, status=2, backoff_factor=0.5,
                  status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET", "HEAD"))
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=40, pool_maxsize=40))
    s.mount("http://", HTTPAdapter(max_retries=retry, pool_connections=40, pool_maxsize=40))
    s.headers.update({
        "User-Agent": USER_AGENTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-GB,en;q=0.9",
        "Cache-Control": "no-cache",
    })
    return s


def normalize_url(url: str, base: str | None = None) -> str | None:
    if not url:
        return None
    url = url.strip().replace("&amp;", "&")
    if base:
        url = urllib.parse.urljoin(base, url)
    p = urllib.parse.urlsplit(url)
    if p.scheme not in {"http", "https"} or not p.netloc:
        return None
    host = p.netloc.lower().split(":")[0]
    path = re.sub(r"/{2,}", "/", p.path or "/")
    # Remove tracking and non-content params while retaining pagination/product selectors.
    keep = []
    for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        kl = k.lower()
        if kl.startswith("utm_") or kl in {"gclid", "fbclid", "srsltid", "ref", "source"}:
            continue
        keep.append((k, v))
    query = urllib.parse.urlencode(keep, doseq=True)
    return urllib.parse.urlunsplit(("https", host, path, query, ""))


def same_site(url: str, site: Site) -> bool:
    host = urllib.parse.urlsplit(url).netloc.lower().split(":")[0]
    target = site.domain.lower().removeprefix("www.")
    return host.removeprefix("www.") == target or host.endswith("." + target)


def get(session: requests.Session, url: str, timeout: int = 25) -> requests.Response | None:
    try:
        return session.get(url, timeout=timeout, allow_redirects=True)
    except requests.RequestException:
        return None


def decode_xml_content(resp: requests.Response, url: str) -> bytes:
    data = resp.content
    if url.endswith(".gz") or resp.headers.get("content-type", "").lower().find("gzip") >= 0:
        try:
            return gzip.decompress(data)
        except OSError:
            pass
    return data


def robots_sitemaps(session: requests.Session, site: Site) -> list[str]:
    roots = {f"https://{site.domain}"}
    roots.update(f"https://{urllib.parse.urlsplit(u).netloc}" for u in site.start_urls)
    found: list[str] = []
    for root in roots:
        resp = get(session, root + "/robots.txt", 15)
        if resp and resp.status_code < 400:
            for line in resp.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    u = normalize_url(line.split(":", 1)[1].strip())
                    if u:
                        found.append(u)
    for root in roots:
        found.extend([
            root + "/sitemap.xml",
            root + "/sitemap_index.xml",
            root + "/sitemap-index.xml",
            root + "/sitemap/sitemap.xml",
            root + "/sitemap_products_1.xml",
        ])
    return list(dict.fromkeys(found))


def sitemap_candidates(session: requests.Session, site: Site) -> tuple[list[Candidate], list[dict]]:
    out: list[Candidate] = []
    logs: list[dict] = []
    q = deque(robots_sitemaps(session, site))
    seen: set[str] = set()
    order = 0
    while q and len(seen) < site.max_sitemap_files and len(out) < site.max_candidates:
        sm_url = q.popleft()
        if sm_url in seen:
            continue
        seen.add(sm_url)
        resp = get(session, sm_url, 30)
        if not resp or resp.status_code >= 400:
            logs.append({"store": site.store, "method": "sitemap", "url": sm_url,
                         "status": getattr(resp, "status_code", "request_error"), "detail": "unavailable"})
            continue
        content = decode_xml_content(resp, sm_url)
        if len(content) > 80_000_000:
            logs.append({"store": site.store, "method": "sitemap", "url": sm_url,
                         "status": resp.status_code, "detail": "skipped_too_large"})
            continue
        try:
            root = ET.fromstring(content)
        except ET.ParseError:
            logs.append({"store": site.store, "method": "sitemap", "url": sm_url,
                         "status": resp.status_code, "detail": "invalid_xml"})
            continue
        tag = root.tag.lower()
        locs = [n.text.strip() for n in root.iter() if n.tag.lower().endswith("loc") and n.text]
        if tag.endswith("sitemapindex"):
            for loc in locs:
                u = normalize_url(loc)
                if u and u not in seen:
                    # Prioritise likely product sitemaps but retain all child sitemaps.
                    if "product" in u.lower() or BRAND_PATH_RE.search(u):
                        q.appendleft(u)
                    else:
                        q.append(u)
            continue
        for loc in locs:
            u = normalize_url(loc)
            if not u or not same_site(u, site):
                continue
            path = urllib.parse.urlsplit(u).path.lower()
            strong = bool(BRAND_PATH_RE.search(u))
            official_productish = site.rank == 1 and (
                path.endswith(".html") or any(h in path for h in site.product_hints)
            )
            if strong or official_productish:
                order += 1
                out.append(Candidate(site.rank, site.store, site.domain, u, "sitemap", sm_url, "", order))
                if len(out) >= site.max_candidates:
                    break
        logs.append({"store": site.store, "method": "sitemap", "url": sm_url,
                     "status": resp.status_code, "detail": f"parsed:{len(locs)}"})
    return out, logs


def jsonld_products(soup: BeautifulSoup, page_url: str) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.string or script.get_text(" ", strip=True)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        stack = [data]
        while stack:
            obj = stack.pop()
            if isinstance(obj, list):
                stack.extend(obj)
            elif isinstance(obj, dict):
                typ = obj.get("@type", "")
                types = {str(x).lower() for x in typ} if isinstance(typ, list) else {str(typ).lower()}
                if types & PRODUCT_JSON_TYPES:
                    url = obj.get("url") or obj.get("@id") or page_url
                    name = obj.get("name") or ""
                    u = normalize_url(str(url), page_url)
                    if u:
                        products.append((u, str(name)))
                stack.extend(obj.values())
    return products


def looks_like_product_url(url: str, text: str, site: Site) -> bool:
    p = urllib.parse.urlsplit(url)
    path = p.path.lower()
    full = (url + " " + text).lower()
    if not same_site(url, site):
        return False
    if any(x in path for x in ("/search", "/category", "/categories", "/collections/fred", "/brand/fred", "/brands/fred", "/fred-perry/men", "/fred-perry/women", "/fred-perry/kids")):
        # Collection links may still have /products/ beneath them; allow those.
        if "/products/" not in path and "/product/" not in path and "/prd/" not in path:
            return False
    if site.rank == 1:
        return path.endswith(".html") or "/product/" in path or "/products/" in path
    if site.rank == 4:
        return "/fred-perry/" in path and "/prd/" in path
    if site.rank == 9:
        return "/style/" in path or ("fred perry" in full and re.search(r"/[a-z0-9]{5,}", path))
    if site.rank in {11, 22, 25}:
        return "/products/" in path and ("fred" in full or BRAND_PATH_RE.search(path))
    if site.rank == 14:
        return "/product/" in path and ("fred" in full or BRAND_PATH_RE.search(path))
    if site.rank == 16:
        return path.endswith(".html") and "fred-perry" in path
    if site.rank in {13, 24}:
        return "/product/" in path and ("fred" in full or BRAND_PATH_RE.search(path))
    if any(h.lower() in path for h in site.product_hints):
        return bool(BRAND_PATH_RE.search(full) or "fred perry" in full)
    return bool(BRAND_PATH_RE.search(path) and not path.rstrip("/").endswith(("fred-perry", "fredperry")))


def is_pagination_link(url: str, text: str, site: Site) -> bool:
    if not same_site(url, site):
        return False
    s = (url + " " + text).lower()
    if any(k in s for k in ("page=", "p=", "currentpage=", "start=", "offset=", "/page/")):
        return True
    return text.strip().lower() in {"next", "next page", "load more", "show more", "more", ">", "›", "→"}


def html_crawl(session: requests.Session, site: Site) -> tuple[list[Candidate], list[dict]]:
    out: list[Candidate] = []
    logs: list[dict] = []
    queue = deque((u, 0) for u in site.start_urls)
    seen_pages: set[str] = set()
    seen_products: set[str] = set()
    order = 0
    while queue and len(seen_pages) < site.max_pages and len(out) < site.max_candidates:
        page_url, depth = queue.popleft()
        page_url = normalize_url(page_url) or page_url
        if page_url in seen_pages:
            continue
        seen_pages.add(page_url)
        resp = get(session, page_url, 30)
        if not resp:
            logs.append({"store": site.store, "method": "html", "url": page_url,
                         "status": "request_error", "detail": "unavailable"})
            continue
        logs.append({"store": site.store, "method": "html", "url": page_url,
                     "status": resp.status_code, "detail": f"bytes:{len(resp.content)}"})
        if resp.status_code >= 400 or not resp.text:
            continue
        final_url = normalize_url(resp.url) or page_url
        soup = BeautifulSoup(resp.text, "lxml")
        for u, name in jsonld_products(soup, final_url):
            if looks_like_product_url(u, name, site) and u not in seen_products:
                seen_products.add(u); order += 1
                out.append(Candidate(site.rank, site.store, site.domain, u, "jsonld", final_url, name, order))
        for a in soup.find_all("a", href=True):
            href = normalize_url(a.get("href", ""), final_url)
            if not href:
                continue
            text = a.get_text(" ", strip=True) or a.get("aria-label", "") or a.get("title", "") or ""
            if looks_like_product_url(href, text, site) and href not in seen_products:
                seen_products.add(href); order += 1
                out.append(Candidate(site.rank, site.store, site.domain, href, "brand_page", final_url, text, order))
                if len(out) >= site.max_candidates:
                    break
            elif depth < 3 and is_pagination_link(href, text, site) and href not in seen_pages:
                queue.append((href, depth + 1))
        # Common deterministic pagination fallbacks when explicit next links are hidden.
        if depth < 2 and len(seen_pages) < site.max_pages:
            for n in range(2, min(8, site.max_pages) + 1):
                p = urllib.parse.urlsplit(final_url)
                qs = dict(urllib.parse.parse_qsl(p.query))
                if "page" not in qs:
                    qs["page"] = str(n)
                    u = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(qs), ""))
                    if u not in seen_pages:
                        queue.append((u, depth + 1))
    return out, logs


def shopify_candidates(session: requests.Session, site: Site) -> tuple[list[Candidate], list[dict]]:
    out: list[Candidate] = []
    logs: list[dict] = []
    roots = {f"https://{site.domain}"}
    collection_handles = set()
    for u in site.start_urls:
        m = re.search(r"/collections/([^/?#]+)", u)
        if m:
            collection_handles.add(m.group(1))
    endpoints = []
    for root in roots:
        for handle in collection_handles:
            endpoints.append((f"{root}/collections/{handle}/products.json", True))
        endpoints.append((f"{root}/products.json", False))
    seen = set(); order = 0
    for endpoint, collection_specific in endpoints:
        for page in range(1, 21):
            url = f"{endpoint}?limit=250&page={page}"
            resp = get(session, url, 30)
            if not resp or resp.status_code >= 400:
                logs.append({"store": site.store, "method": "shopify", "url": url,
                             "status": getattr(resp, "status_code", "request_error"), "detail": "unavailable"})
                break
            try:
                products = resp.json().get("products", [])
            except Exception:
                break
            logs.append({"store": site.store, "method": "shopify", "url": url,
                         "status": resp.status_code, "detail": f"products:{len(products)}"})
            if not products:
                break
            for p in products:
                title = str(p.get("title") or "")
                vendor = str(p.get("vendor") or "")
                handle = str(p.get("handle") or "")
                if not collection_specific and not BRAND_RE.search(title + " " + vendor + " " + handle):
                    continue
                product_url = normalize_url(f"https://{site.domain}/products/{handle}")
                if product_url and product_url not in seen:
                    seen.add(product_url); order += 1
                    out.append(Candidate(site.rank, site.store, site.domain, product_url,
                                         "shopify_api", url, title, order))
            if len(products) < 250 or len(out) >= site.max_candidates:
                break
        if out and collection_specific:
            break
    return out, logs


def woocommerce_candidates(session: requests.Session, site: Site) -> tuple[list[Candidate], list[dict]]:
    out: list[Candidate] = []
    logs: list[dict] = []
    endpoint = f"https://{site.domain}/wp-json/wc/store/v1/products"
    seen = set(); order = 0
    for page in range(1, 21):
        url = endpoint + "?search=Fred%20Perry&per_page=100&page=" + str(page)
        resp = get(session, url, 30)
        if not resp or resp.status_code >= 400:
            logs.append({"store": site.store, "method": "woocommerce", "url": url,
                         "status": getattr(resp, "status_code", "request_error"), "detail": "unavailable"})
            break
        try:
            products = resp.json()
        except Exception:
            break
        if not isinstance(products, list):
            break
        logs.append({"store": site.store, "method": "woocommerce", "url": url,
                     "status": resp.status_code, "detail": f"products:{len(products)}"})
        if not products:
            break
        for p in products:
            name = str(p.get("name") or "")
            permalink = normalize_url(str(p.get("permalink") or ""))
            if permalink and BRAND_RE.search(name + " " + permalink) and permalink not in seen:
                seen.add(permalink); order += 1
                out.append(Candidate(site.rank, site.store, site.domain, permalink,
                                     "woocommerce_api", url, name, order))
        if len(products) < 100 or len(out) >= site.max_candidates:
            break
    return out, logs


def selenium_fallback(site: Site) -> tuple[list[Candidate], list[dict]]:
    out: list[Candidate] = []
    logs: list[dict] = []
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
    except Exception as exc:
        return out, [{"store": site.store, "method": "selenium", "url": "", "status": "not_available", "detail": str(exc)}]
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1440,2400")
    opts.add_argument("--lang=en-GB")
    opts.add_argument("--user-agent=" + USER_AGENTS[1])
    driver = None
    seen = set(); order = 0
    try:
        driver = webdriver.Chrome(options=opts)
        driver.set_page_load_timeout(40)
        for start_url in site.start_urls[:3]:
            try:
                driver.get(start_url)
                time.sleep(3)
                for _ in range(8):
                    driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(1)
                    for label in ("Load more", "Show more", "View more", "More products"):
                        try:
                            buttons = driver.find_elements(By.XPATH, f"//*[self::button or self::a][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'{label.lower()}')]")
                            if buttons and buttons[0].is_displayed():
                                driver.execute_script("arguments[0].click();", buttons[0])
                                time.sleep(1)
                        except Exception:
                            pass
                soup = BeautifulSoup(driver.page_source, "lxml")
                current = normalize_url(driver.current_url) or start_url
                for u, name in jsonld_products(soup, current):
                    if looks_like_product_url(u, name, site) and u not in seen:
                        seen.add(u); order += 1
                        out.append(Candidate(site.rank, site.store, site.domain, u, "rendered_jsonld", current, name, order))
                for a in soup.find_all("a", href=True):
                    u = normalize_url(a.get("href", ""), current)
                    text = a.get_text(" ", strip=True) or a.get("aria-label", "") or ""
                    if u and looks_like_product_url(u, text, site) and u not in seen:
                        seen.add(u); order += 1
                        out.append(Candidate(site.rank, site.store, site.domain, u, "rendered_brand_page", current, text, order))
                logs.append({"store": site.store, "method": "selenium", "url": start_url,
                             "status": "ok", "detail": f"products:{len(out)}"})
            except Exception as exc:
                logs.append({"store": site.store, "method": "selenium", "url": start_url,
                             "status": "error", "detail": type(exc).__name__ + ":" + str(exc)[:200]})
    except Exception as exc:
        logs.append({"store": site.store, "method": "selenium", "url": "",
                     "status": "driver_error", "detail": type(exc).__name__ + ":" + str(exc)[:300]})
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
    return out, logs


def merge_candidates(groups: Iterable[Iterable[Candidate]], site: Site) -> list[Candidate]:
    priority = {"shopify_api": 1, "woocommerce_api": 1, "jsonld": 2, "rendered_jsonld": 2,
                "brand_page": 3, "rendered_brand_page": 3, "sitemap": 4}
    by_url: dict[str, Candidate] = {}
    for group in groups:
        for c in group:
            u = normalize_url(c.url)
            if not u or not same_site(u, site):
                continue
            old = by_url.get(u)
            if old is None or priority.get(c.source, 99) < priority.get(old.source, 99):
                c.url = u
                by_url[u] = c
    return list(by_url.values())[:site.max_candidates]


def parse_product_page(resp: requests.Response, candidate: Candidate, site: Site) -> ProductRow:
    url = normalize_url(resp.url) or candidate.url
    text = resp.text or ""
    soup = BeautifulSoup(text, "lxml") if text else None
    title = candidate.title_hint.strip()
    canonical = url
    availability = "unknown"
    if soup:
        can = soup.select_one('link[rel="canonical"]')
        if can and can.get("href"):
            canonical = normalize_url(can.get("href"), url) or url
        if not title:
            h1 = soup.find("h1")
            title = h1.get_text(" ", strip=True) if h1 else ""
        if not title and soup.title:
            title = soup.title.get_text(" ", strip=True)
        low = text.lower()
        m = re.search(r'"availability"\s*:\s*"(?:https?://schema\.org/)?(instock|outofstock|preorder|backorder|discontinued|soldout)"', low, re.I)
        if m:
            availability = m.group(1).lower()
        elif re.search(r"\b(out of stock|sold out|currently unavailable|not available)\b", low):
            availability = "outofstock"
        elif re.search(r"\b(add to bag|add to cart|add to basket|buy now|in stock)\b", low):
            availability = "instock"
    brand_ok = bool(BRAND_RE.search(title + " " + text[:400000]))
    product_signal = bool(soup and (soup.select_one('[itemtype*="Product"]') or
                                   soup.select_one('meta[property="og:type"][content="product"]') or
                                   jsonld_products(soup, url)))
    if resp.status_code in {401, 403, 429}:
        status = "blocked_unverified"
    elif resp.status_code >= 400:
        status = "http_error"
    elif site.rank == 1 and product_signal:
        status = "verified_product"
    elif brand_ok and product_signal:
        status = "verified_product"
    elif brand_ok and candidate.source in {"shopify_api", "woocommerce_api", "brand_page", "rendered_brand_page", "jsonld", "rendered_jsonld"}:
        status = "strong_candidate"
    elif resp.status_code < 400 and BRAND_PATH_RE.search(candidate.url):
        status = "unverified_candidate"
    else:
        status = "rejected_not_confirmed"
    return ProductRow(candidate.rank, candidate.store, candidate.domain, candidate.url, canonical,
                      title[:500], resp.status_code, status, availability, candidate.source,
                      candidate.source_url, hashlib.sha256(candidate.url.encode()).hexdigest(), UTC_NOW)


def validate_candidate(candidate: Candidate, site_by_domain: dict[str, Site]) -> ProductRow:
    session = make_session()
    site = site_by_domain[candidate.domain]
    resp = get(session, candidate.url, 25)
    if not resp:
        return ProductRow(candidate.rank, candidate.store, candidate.domain, candidate.url, candidate.url,
                          candidate.title_hint[:500], "request_error", "request_error", "unknown",
                          candidate.source, candidate.source_url,
                          hashlib.sha256(candidate.url.encode()).hexdigest(), UTC_NOW)
    return parse_product_page(resp, candidate, site)


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output-dir", default="artifact")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    all_candidates: list[Candidate] = []
    discovery_logs: list[dict] = []
    method_counts: dict[str, dict[str, int]] = defaultdict(dict)

    for site in SITES:
        print(f"::group::{site.rank:02d} {site.store}", flush=True)
        session = make_session()
        sitemap, l1 = sitemap_candidates(session, site)
        html, l2 = html_crawl(session, site)
        shopify, l3 = shopify_candidates(session, site)
        woo, l4 = woocommerce_candidates(session, site)
        groups = [sitemap, html, shopify, woo]
        merged_pre = merge_candidates(groups, site)
        selenium: list[Candidate] = []
        l5: list[dict] = []
        if len(merged_pre) < 20:
            selenium, l5 = selenium_fallback(site)
            groups.append(selenium)
        merged = merge_candidates(groups, site)
        all_candidates.extend(merged)
        discovery_logs.extend(l1 + l2 + l3 + l4 + l5)
        method_counts[site.store] = {
            "sitemap": len(sitemap), "html": len(html), "shopify": len(shopify),
            "woocommerce": len(woo), "selenium": len(selenium), "deduplicated": len(merged)
        }
        print(json.dumps(method_counts[site.store], ensure_ascii=False), flush=True)
        print("::endgroup::", flush=True)

    # Global exact URL dedupe while retaining the retailer association.
    deduped: dict[tuple[str, str], Candidate] = {}
    for c in all_candidates:
        deduped[(c.domain, c.url)] = c
    candidates = list(deduped.values())
    print(f"Validating {len(candidates)} unique candidates", flush=True)
    site_by_domain = {s.domain: s for s in SITES}
    product_rows: list[ProductRow] = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 24))) as ex:
        futures = {ex.submit(validate_candidate, c, site_by_domain): c for c in candidates}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                product_rows.append(fut.result())
            except Exception as exc:
                c = futures[fut]
                product_rows.append(ProductRow(c.rank, c.store, c.domain, c.url, c.url,
                                               c.title_hint[:500], "validator_error", "validator_error",
                                               "unknown", c.source, c.source_url,
                                               hashlib.sha256(c.url.encode()).hexdigest(), UTC_NOW))
            if i % 250 == 0:
                print(f"validated {i}/{len(candidates)}", flush=True)

    keep_status = {"verified_product", "strong_candidate", "blocked_unverified", "unverified_candidate", "request_error"}
    kept = [r for r in product_rows if r.verification_status in keep_status]
    rejected = [r for r in product_rows if r.verification_status not in keep_status]
    kept.sort(key=lambda r: (r.rank, r.product_name.lower(), r.product_url))
    rejected.sort(key=lambda r: (r.rank, r.product_url))

    summary = []
    for site in SITES:
        rows = [r for r in kept if r.domain == site.domain]
        verified = sum(r.verification_status == "verified_product" for r in rows)
        strong = sum(r.verification_status == "strong_candidate" for r in rows)
        blocked = sum(r.verification_status == "blocked_unverified" for r in rows)
        request_errors = sum(r.verification_status == "request_error" for r in rows)
        instock = sum(r.availability == "instock" for r in rows)
        outstock = sum(r.availability == "outofstock" for r in rows)
        summary.append({
            "rank": site.rank,
            "store": site.store,
            "domain": site.domain,
            "product_urls_kept": len(rows),
            "verified_product": verified,
            "strong_candidate": strong,
            "blocked_unverified": blocked,
            "request_error": request_errors,
            "availability_instock": instock,
            "availability_outofstock": outstock,
            "candidate_count_before_validation": method_counts.get(site.store, {}).get("deduplicated", 0),
            "coverage_status": "complete_or_near_complete" if len(rows) >= 20 and (verified + strong) / max(1, len(rows)) >= 0.75 else ("partial_blocked" if blocked or request_errors else "partial_or_zero"),
            "captured_at_utc": UTC_NOW,
        })

    product_fields = list(asdict(kept[0]).keys()) if kept else list(ProductRow.__annotations__.keys())
    write_csv(outdir / "fred_perry_product_urls_all.csv", [asdict(r) for r in kept], product_fields)
    write_csv(outdir / "fred_perry_product_urls_rejected.csv", [asdict(r) for r in rejected], product_fields)
    summary_fields = list(summary[0].keys())
    write_csv(outdir / "fred_perry_product_url_summary.csv", summary, summary_fields)
    log_fields = ["store", "method", "url", "status", "detail"]
    write_csv(outdir / "fred_perry_discovery_log.csv", discovery_logs, log_fields)

    per_store = outdir / "per_store"
    per_store.mkdir(exist_ok=True)
    for site in SITES:
        rows = [r for r in kept if r.domain == site.domain]
        slug = re.sub(r"[^a-z0-9]+", "_", site.store.lower()).strip("_")
        write_csv(per_store / f"{site.rank:02d}_{slug}.csv", [asdict(r) for r in rows], product_fields)
        with (per_store / f"{site.rank:02d}_{slug}_urls.txt").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(r.product_url + "\n")

    manifest = {
        "schema": "RLF_FRED_PERRY_PRODUCT_URL_MAP_V1",
        "created_at_utc": UTC_NOW,
        "stores": len(SITES),
        "candidate_urls": len(candidates),
        "kept_urls": len(kept),
        "rejected_urls": len(rejected),
        "method_counts": method_counts,
        "summary": summary,
        "guardrails": [
            "No fabricated URLs",
            "Every URL has a recorded discovery source",
            "Blocked candidates retained only when source evidence is strong",
            "Rejected candidates kept in a separate audit file",
        ],
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    (outdir / "README.md").write_text(
        "# Fred Perry product URL map\n\n"
        f"Captured: `{UTC_NOW}`\n\n"
        "This artifact maps Fred Perry product URLs across 25 retailer domains. "
        "It uses public sitemaps, brand/category pages, Shopify/WooCommerce public endpoints, "
        "and a rendered-browser fallback. URLs are never invented. Review `coverage_status` "
        "and `verification_status` before treating a retailer as exhaustively mapped.\n",
        encoding="utf-8",
    )
    print(json.dumps({"kept": len(kept), "rejected": len(rejected), "stores": len(SITES)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
