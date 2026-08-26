#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import html as htmlmod
import json
import mimetypes
import re
import sys
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 RLF-KB-Research/1.0"
)
TIMEOUT = 35
MAX_IMAGES_PER_CANDIDATE = 8
IMAGE_MAX_BYTES = 18 * 1024 * 1024
EXPLICIT_FIELDS = [
    "product_name", "style_code", "colour_code", "colour_name", "material",
    "category", "gender_marketing", "country_of_manufacture", "manufacturer",
    "season", "year_exact", "description", "availability",
]
FORENSIC_ROLES = [
    "MACRO_BRAND_LABEL_FRONT",
    "MACRO_BRAND_LABEL_BACK_OR_STITCHING",
    "MACRO_CARE_LABEL_FRONT",
    "MACRO_CARE_LABEL_REVERSE",
    "MACRO_STYLE_SIZE_COLOUR_CODE",
    "MACRO_FACTORY_OR_CONSTRUCTION",
]
GENERIC_ROLES = [
    "GEN_FRONT_FULL", "GEN_BACK_FULL", "GEN_SIDE_OR_INTERIOR", "GEN_CONTEXT_DETAIL"
]


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def norm_space(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = "; ".join(norm_space(v) for v in value if norm_space(v))
    if isinstance(value, dict):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return re.sub(r"\s+", " ", htmlmod.unescape(str(value))).strip()


def normalize_url(url: str, base: str = "") -> str:
    url = norm_space(url)
    if not url:
        return ""
    url = urllib.parse.urljoin(base, url)
    p = urllib.parse.urlsplit(url)
    if p.scheme not in {"http", "https"}:
        return ""
    keep = []
    for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        if k.lower().startswith("utm_") or k.lower() in {"gclid", "fbclid", "srsltid"}:
            continue
        keep.append((k, v))
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path, urllib.parse.urlencode(keep), ""))


def json_objects(data: Any) -> Iterable[dict[str, Any]]:
    if isinstance(data, dict):
        yield data
        graph = data.get("@graph")
        if graph is not None:
            yield from json_objects(graph)
        for key, value in data.items():
            if key != "@graph" and isinstance(value, (dict, list)):
                yield from json_objects(value)
    elif isinstance(data, list):
        for item in data:
            yield from json_objects(item)


def is_product_object(obj: dict[str, Any]) -> bool:
    typ = obj.get("@type", "")
    if isinstance(typ, list):
        return any(str(x).lower() == "product" for x in typ)
    return str(typ).lower() == "product"


def field_from_product(obj: dict[str, Any], field: str) -> str:
    aliases = {
        "product_name": ["name"],
        "style_code": ["sku", "mpn", "productID", "productId"],
        "colour_name": ["color", "colour"],
        "material": ["material"],
        "category": ["category"],
        "description": ["description"],
    }
    for key in aliases.get(field, []):
        val = obj.get(key)
        if val not in (None, "", []):
            return norm_space(val)
    if field == "manufacturer":
        val = obj.get("manufacturer") or obj.get("brand")
        if isinstance(val, dict):
            return norm_space(val.get("name"))
        return norm_space(val)
    if field == "availability":
        offers = obj.get("offers")
        offers_list = offers if isinstance(offers, list) else [offers] if offers else []
        vals = []
        for offer in offers_list:
            if isinstance(offer, dict) and offer.get("availability"):
                vals.append(str(offer["availability"]).rsplit("/", 1)[-1])
        return "; ".join(sorted(set(vals)))
    return ""


def image_urls_from_product(obj: dict[str, Any], base: str) -> list[str]:
    vals: list[Any] = []
    for key in ("image", "images", "associatedMedia"):
        if key in obj:
            vals.append(obj[key])
    out: list[str] = []
    def add(v: Any) -> None:
        if isinstance(v, str):
            u = normalize_url(v, base)
            if u:
                out.append(u)
        elif isinstance(v, dict):
            for key in ("url", "contentUrl", "thumbnailUrl"):
                if v.get(key):
                    add(v[key])
        elif isinstance(v, list):
            for x in v:
                add(x)
    for v in vals:
        add(v)
    return list(dict.fromkeys(out))


def extract_page(url: str, session: requests.Session) -> tuple[dict[str, str], list[str], str]:
    observed_at = utcnow()
    row: dict[str, str] = {
        "source_url": url, "resolved_url": "", "http_status": "", "fetch_status": "",
        "content_type": "", "page_title": "", "canonical_url": "", "observed_at_utc": observed_at,
    }
    images: list[str] = []
    try:
        resp = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        row["resolved_url"] = resp.url
        row["http_status"] = str(resp.status_code)
        row["content_type"] = resp.headers.get("content-type", "")[:200]
        if resp.status_code >= 400:
            row["fetch_status"] = "HTTP_ERROR"
            return row, images, ""
        text = resp.text
        row["fetch_status"] = "FETCHED"
    except Exception as exc:
        row["fetch_status"] = "REQUEST_ERROR"
        row["fetch_error"] = f"{type(exc).__name__}: {exc}"[:500]
        return row, images, ""

    soup = BeautifulSoup(text, "html.parser")
    row["page_title"] = norm_space(soup.title.get_text(" ") if soup.title else "")
    can = soup.find("link", rel=lambda x: x and "canonical" in str(x).lower())
    if can and can.get("href"):
        row["canonical_url"] = normalize_url(can.get("href"), resp.url)

    meta_map: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("property") or tag.get("name") or tag.get("itemprop")
        val = tag.get("content")
        if key and val:
            meta_map[str(key).lower()] = norm_space(val)
    row["meta_description"] = meta_map.get("description", "") or meta_map.get("og:description", "")
    row["meta_product_name"] = meta_map.get("og:title", "") or meta_map.get("twitter:title", "")
    for key in ("og:image", "og:image:secure_url", "twitter:image"):
        if meta_map.get(key):
            u = normalize_url(meta_map[key], resp.url)
            if u:
                images.append(u)

    products: list[dict[str, Any]] = []
    for script in soup.find_all("script", type=lambda x: x and "ld+json" in str(x).lower()):
        raw = script.string or script.get_text("", strip=False)
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            cleaned = raw.strip().strip("<!--").strip("-->")
            try:
                data = json.loads(cleaned)
            except Exception:
                continue
        for obj in json_objects(data):
            if is_product_object(obj):
                products.append(obj)

    products.sort(key=lambda o: len(json.dumps(o, ensure_ascii=False)), reverse=True)
    product = products[0] if products else {}
    row["jsonld_product_found"] = "1" if product else "0"
    for field in EXPLICIT_FIELDS:
        value = field_from_product(product, field)
        if value:
            row[f"jsonld_{field}"] = value
    images.extend(image_urls_from_product(product, resp.url))

    meta_aliases = {
        "colour_name": ["product:color", "og:product:color"],
        "material": ["product:material"],
        "availability": ["product:availability", "og:availability"],
    }
    for field, keys in meta_aliases.items():
        for key in keys:
            if meta_map.get(key):
                row[f"meta_{field}"] = meta_map[key]
                break

    for tag in soup.find_all(["img", "source"]):
        attrs = [tag.get("src"), tag.get("data-src"), tag.get("data-original"), tag.get("srcset"), tag.get("data-srcset")]
        for value in attrs:
            if not value:
                continue
            for part in str(value).split(","):
                candidate = part.strip().split(" ")[0]
                u = normalize_url(candidate, resp.url)
                if not u:
                    continue
                low = u.lower()
                if any(tok in low for tok in ("logo", "icon", "sprite", "payment", "flag", "avatar")):
                    continue
                if re.search(r"\.(?:jpe?g|png|webp|avif)(?:\?|$)", low) or any(tok in low for tok in ("image", "media", "cdn")):
                    images.append(u)

    images = list(dict.fromkeys(images))
    row["raw_html_sha256"] = hashlib.sha256(text.encode(resp.encoding or "utf-8", errors="replace")).hexdigest()
    return row, images, text


def explicit_assertions(candidate: dict[str, str], source: dict[str, str]) -> list[dict[str, str]]:
    assertions: list[dict[str, str]] = []
    def add(field: str, value: str, extraction: str, grade: str = "B") -> None:
        value = norm_space(value)
        if not value:
            return
        assertions.append({
            "candidate_id": candidate["candidate_id"],
            "style_code_seed": candidate["style_code"],
            "colour_code_seed": candidate["colour_code"],
            "field_name": field,
            "observed_value": value,
            "source_url": source["source_url"],
            "extraction_method": extraction,
            "evidence_grade": grade,
            "assertion_status": "proposed",
            "observed_at_utc": source.get("observed_at_utc", ""),
        })
    add("style_code", candidate["style_code"], "seed_url_explicit", "B")
    add("colour_code", candidate["colour_code"], "seed_url_explicit", "B")
    if candidate.get("model_name_candidate"):
        add("product_name", candidate["model_name_candidate"], "seed_slug_explicit", "C")
    for field in EXPLICIT_FIELDS:
        val = source.get(f"jsonld_{field}", "")
        if val:
            add(field, val, "jsonld_product", "B")
        mval = source.get(f"meta_{field}", "")
        if mval:
            add(field, mval, "meta_tag", "C")
    if source.get("meta_product_name"):
        add("product_name", source["meta_product_name"], "og_title", "C")
    if source.get("meta_description"):
        add("description", source["meta_description"], "meta_description", "C")
    return assertions


def infer_extension(content_type: str, url: str) -> str:
    ct = content_type.split(";", 1)[0].strip().lower()
    ext = mimetypes.guess_extension(ct) or Path(urllib.parse.urlsplit(url).path).suffix
    ext = ext.lower()
    if ext == ".jpe": ext = ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"}:
        ext = ".bin"
    return ext


def download_image(url: str, dest_base: Path, session: requests.Session) -> dict[str, str]:
    row = {"image_url": url, "download_status": "", "http_status": "", "mime_type": "", "bytes": "", "sha256": "", "local_path": ""}
    try:
        with session.get(url, timeout=TIMEOUT, stream=True, allow_redirects=True) as resp:
            row["http_status"] = str(resp.status_code)
            row["mime_type"] = resp.headers.get("content-type", "")[:120]
            if resp.status_code >= 400:
                row["download_status"] = "HTTP_ERROR"
                return row
            chunks = []
            total = 0
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > IMAGE_MAX_BYTES:
                    row["download_status"] = "TOO_LARGE"
                    return row
                chunks.append(chunk)
            data = b"".join(chunks)
            if not data:
                row["download_status"] = "EMPTY"
                return row
            digest = hashlib.sha256(data).hexdigest()
            ext = infer_extension(row["mime_type"], resp.url)
            path = dest_base.with_name(dest_base.name + ext)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            row.update({"download_status":"DOWNLOADED","bytes":str(len(data)),"sha256":digest,"local_path":path.as_posix()})
            return row
    except Exception as exc:
        row["download_status"] = "REQUEST_ERROR"
        row["error"] = f"{type(exc).__name__}: {exc}"[:400]
        return row


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fields is None:
        seen = []
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.append(k)
        fields = seen
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: rlf_kb_w001_enrich.py SEEDS.csv OUTPUT_DIR")
    seeds_path = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    seeds = list(csv.DictReader(seeds_path.open(encoding="utf-8-sig", newline="")))
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language":"en-GB,en;q=0.9"})

    source_rows: list[dict[str, str]] = []
    assertion_rows: list[dict[str, str]] = []
    image_rows: list[dict[str, str]] = []
    rollups: list[dict[str, Any]] = []
    missing_rows: list[dict[str, str]] = []
    conflict_rows: list[dict[str, str]] = []

    for idx, candidate in enumerate(seeds, 1):
        urls = json.loads(candidate["source_urls_json"])
        candidate_sources: list[dict[str, str]] = []
        candidate_images: list[tuple[str, str]] = []
        for source_idx, url in enumerate(urls, 1):
            source, images, _ = extract_page(url, session)
            source.update({
                "wave_rank": candidate["wave_rank"], "candidate_id": candidate["candidate_id"],
                "style_code_seed": candidate["style_code"], "colour_code_seed": candidate["colour_code"],
                "source_index": str(source_idx), "image_candidates_found": str(len(images)),
            })
            source_rows.append(source)
            candidate_sources.append(source)
            assertion_rows.extend(explicit_assertions(candidate, source))
            for image_url in images:
                candidate_images.append((image_url, url))
            time.sleep(0.08)

        unique_images: list[tuple[str, str]] = []
        seen_urls = set()
        for image_url, page_url in candidate_images:
            key = normalize_url(image_url)
            if not key or key in seen_urls:
                continue
            seen_urls.add(key)
            unique_images.append((key, page_url))
        downloaded = 0
        for img_idx, (image_url, page_url) in enumerate(unique_images[:MAX_IMAGES_PER_CANDIDATE], 1):
            base = out / "images" / candidate["candidate_id"] / f"source_{img_idx:02d}"
            d = download_image(image_url, base, session)
            d.update({
                "candidate_id": candidate["candidate_id"], "style_code": candidate["style_code"],
                "colour_code": candidate["colour_code"], "referring_page": page_url,
                "image_sequence": str(img_idx), "proposed_role": f"GENERIC_UNCLASSIFIED_{img_idx:02d}",
                "role_status": "VISUAL_REVIEW_REQUIRED", "captured_at_utc": utcnow(),
            })
            if d["download_status"] == "DOWNLOADED":
                downloaded += 1
            image_rows.append(d)

        for role in GENERIC_ROLES:
            missing_rows.append({
                "candidate_id": candidate["candidate_id"], "style_code": candidate["style_code"], "colour_code": candidate["colour_code"],
                "required_role": role, "queue_status": "VISUAL_CLASSIFICATION_PENDING" if downloaded else "ACQUISITION_REQUIRED",
                "reason": f"{downloaded} unclassified generic image candidates downloaded" if downloaded else "No image bytes downloaded",
            })
        for role in FORENSIC_ROLES:
            missing_rows.append({
                "candidate_id": candidate["candidate_id"], "style_code": candidate["style_code"], "colour_code": candidate["colour_code"],
                "required_role": role, "queue_status": "ACQUISITION_REQUIRED",
                "reason": "Retail product pages normally lack garment-label macro evidence; no automatic role assignment",
            })

        by_field: dict[str, set[str]] = defaultdict(set)
        for a in assertion_rows:
            if a["candidate_id"] == candidate["candidate_id"] and a["field_name"] not in {"description"}:
                value = a["observed_value"].casefold().strip()
                if value:
                    by_field[a["field_name"]].add(value)
        for field, values in by_field.items():
            if len(values) > 1 and field in {"style_code", "colour_code", "colour_name", "material", "country_of_manufacture", "manufacturer", "season", "year_exact"}:
                conflict_rows.append({
                    "candidate_id": candidate["candidate_id"], "style_code": candidate["style_code"], "colour_code": candidate["colour_code"],
                    "field_name": field, "observed_values_json": json.dumps(sorted(values), ensure_ascii=False),
                    "review_status": "OPEN", "resolution": "",
                })

        rollups.append({
            "wave_rank": candidate["wave_rank"], "candidate_id": candidate["candidate_id"],
            "style_code": candidate["style_code"], "colour_code": candidate["colour_code"],
            "model_name_candidate": candidate["model_name_candidate"], "source_urls": len(urls),
            "sources_fetched": sum(s.get("fetch_status") == "FETCHED" for s in candidate_sources),
            "sources_failed": sum(s.get("fetch_status") != "FETCHED" for s in candidate_sources),
            "explicit_assertions": sum(a["candidate_id"] == candidate["candidate_id"] for a in assertion_rows),
            "image_urls_discovered": len(unique_images), "images_downloaded": downloaded,
            "generic_roles_complete": 0, "forensic_roles_complete": 0,
            "record_state": "IDENTITY_PARTIAL" if any(s.get("fetch_status") == "FETCHED" for s in candidate_sources) else "URL_ONLY",
            "promotion_status": "NOT_PROMOTED_REVIEW_REQUIRED",
        })
        print(f"[{idx:02d}/{len(seeds)}] {candidate['style_code']}-{candidate['colour_code']} sources={len(urls)} downloaded={downloaded}", flush=True)

    write_csv(out / "w001_source_observations.csv", source_rows)
    write_csv(out / "w001_field_assertions.csv", assertion_rows)
    write_csv(out / "w001_image_assets.csv", image_rows)
    write_csv(out / "w001_candidate_rollup.csv", rollups)
    write_csv(out / "w001_required_image_roles_queue.csv", missing_rows)
    write_csv(out / "w001_conflicts.csv", conflict_rows)

    manifest = {
        "schema": "RLF_KB_W001_ENRICHMENT_V1",
        "generated_at_utc": utcnow(),
        "policy": "APPEND_ONLY_FAIL_CLOSED",
        "candidates": len(seeds),
        "source_observations": len(source_rows),
        "sources_fetched": sum(r.get("fetch_status") == "FETCHED" for r in source_rows),
        "field_assertions": len(assertion_rows),
        "image_urls_processed": len(image_rows),
        "images_downloaded": sum(r.get("download_status") == "DOWNLOADED" for r in image_rows),
        "required_image_role_tasks": len(missing_rows),
        "conflicts": len(conflict_rows),
        "guardrails": [
            "No value inferred from visual appearance",
            "No manufacturing year inferred from listing date",
            "No factory inferred from Made in country",
            "Downloaded product images remain unclassified until visual review",
            "All forensic macro roles remain open unless a true macro source is explicitly verified",
            "No candidate automatically promoted to a canonical production variant",
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "README.md").write_text(
        "# RLF KB W001 — Top 50 enrichment\n\n"
        "This package contains point-in-time source observations, explicit field assertions, original image bytes where accessible, "
        "unclassified generic image candidates, missing forensic-role queues and conflicts. It does not promote candidates into canonical production variants.\n",
        encoding="utf-8",
    )
    sums = []
    for p in sorted(x for x in out.rglob("*") if x.is_file() and x.name != "SHA256SUMS.txt"):
        sums.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}")
    (out / "SHA256SUMS.txt").write_text("\n".join(sums)+"\n", encoding="utf-8")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
