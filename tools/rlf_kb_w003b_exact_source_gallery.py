#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw

OUT = Path("w003b-exact-source-gallery")
IMG = OUT / "images"
SHEETS = OUT / "contact_sheets"
OUT.mkdir(exist_ok=True)
IMG.mkdir(exist_ok=True)
SHEETS.mkdir(exist_ok=True)

SEEDS = [
    ("M3600::04C", "EXACT_SKU", "https://www.suitable.es/fred-perry/polo-shirts/fred-perry-polo-twin-tipped-m3600-pink-04c.html"),
    ("M3600::85B", "EXACT_SKU", "https://www.suitable.es/fred-perry/polo-shirts/fred-perry-polo-twin-tipped-m3600-grey-85b.html"),
    ("M3600::87B", "EXACT_SKU", "https://www.eqvvs.co.uk/products/fred-perry-twin-tipped-fred-perry-polo-shirt-87b-laurel-wreath-green-ecru-dusky-blue-m3600"),
    ("M3600::T50", "EXACT_SKU_JP", "https://www.fredperry.jp/shop/g/gM3600-4550392324483/"),
    ("M3600::T60", "EXACT_SKU_JP", "https://www.fredperry.jp/shop/g/gM3600-4550392325091/"),
    ("M3600::U98", "EXACT_SKU_JP", "https://www.fredperry.jp/shop/g/gM3600-4550392381868/"),
    ("M3600::U98", "EXACT_SKU", "https://calif.cc/products/191242014026"),
    ("M3600::350", "EXACT_SKU_JP", "https://www.fredperry.jp/shop/g/gM3600-4550392113759"),
    ("M3600::350", "EXACT_SKU", "https://www.suitable.sk/fred-perry/polo-shirts/fred-perry-polo-shirt-black-350.html"),
    ("L7255::81A", "EXACT_SKU", "https://www.hhv.de/en-US/clothing/item/fred-perry-classic-barrel-bag-grassroots-ecru-1299369"),
]

DIRECT_IMAGES = [
    ("MODEL::M3600", "MODEL_LEVEL_ONLY", "M3600-S07", "https://i.ebayimg.com/images/g/SNUAAOSw7z9mgCl3/s-l1200.jpg"),
]

URL_RE = re.compile(r"https?:\\?/\\?/[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]+", re.I)
IMG_EXT_RE = re.compile(r"\\.(?:jpe?g|png|webp|avif)(?:$|[?&#])", re.I)
NEG_RE = re.compile(r"(?:logo|icon|sprite|payment|flag|trust|avatar|badge|placeholder|loading|spinner|newsletter)", re.I)


def canon_url(raw: str, base: str) -> str | None:
    if not raw:
        return None
    raw = raw.replace("\\/", "/").strip().strip('"\'')
    if raw.startswith("//"):
        raw = "https:" + raw
    raw = urllib.parse.urljoin(base, raw)
    p = urllib.parse.urlsplit(raw)
    if p.scheme not in {"http", "https"}:
        return None
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path, p.query, ""))


def candidate_image_urls(html: str, page_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    found: list[str] = []
    attrs = ("src", "data-src", "data-original", "data-zoom-image", "data-image", "href")
    for tag in soup.find_all(["img", "source", "a"]):
        for attr in attrs:
            val = tag.get(attr)
            if val:
                found.append(val)
        for attr in ("srcset", "data-srcset"):
            val = tag.get(attr)
            if val:
                found.extend(part.strip().split()[0] for part in val.split(",") if part.strip())
    found.extend(m.group(0) for m in URL_RE.finditer(html))
    out, seen = [], set()
    for raw in found:
        u = canon_url(raw, page_url)
        if not u or u in seen:
            continue
        seen.add(u)
        path = urllib.parse.urlsplit(u).path
        if not IMG_EXT_RE.search(u) and not any(k in u.lower() for k in ("image", "cdn", "media", "product")):
            continue
        if NEG_RE.search(path):
            continue
        out.append(u)
    return out


def fetch(url: str):
    return requests.get(url, impersonate="chrome", timeout=45, allow_redirects=True,
                        headers={"Accept-Language": "en-GB,en;q=0.9,ja;q=0.7"})


def save_image(scope: str, relation: str, source_page: str, image_url: str, ordinal: int):
    try:
        r = fetch(image_url)
        data = bytes(r.content)
        ctype = (r.headers.get("content-type") or "").split(";")[0].lower()
        if r.status_code != 200 or len(data) < 5000:
            return {"scope_key": scope, "relation": relation, "source_page": source_page,
                    "image_url": image_url, "http_status": r.status_code, "bytes": len(data),
                    "status": "REJECT_HTTP_OR_SIZE"}
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
            width, height = im.size
            fmt = (im.format or "JPEG").lower()
        except Exception:
            return {"scope_key": scope, "relation": relation, "source_page": source_page,
                    "image_url": image_url, "http_status": r.status_code, "bytes": len(data),
                    "status": "REJECT_DECODE"}
        if width < 250 or height < 250:
            return {"scope_key": scope, "relation": relation, "source_page": source_page,
                    "image_url": image_url, "http_status": r.status_code, "bytes": len(data),
                    "width": width, "height": height, "status": "REJECT_DIMENSIONS"}
        sha = hashlib.sha256(data).hexdigest()
        ext = ".jpg" if fmt in {"jpeg", "jpg"} else "." + fmt
        d = IMG / re.sub(r"[^A-Za-z0-9._-]+", "_", scope)
        d.mkdir(exist_ok=True)
        path = d / f"{ordinal:03d}_{sha[:12]}{ext}"
        if not path.exists():
            path.write_bytes(data)
        return {"scope_key": scope, "relation": relation, "source_page": source_page,
                "image_url": image_url, "final_url": str(r.url), "http_status": r.status_code,
                "content_type": ctype, "bytes": len(data), "width": width, "height": height,
                "sha256": sha, "local_path": path.as_posix(), "status": "DOWNLOADED_PENDING_VISUAL_REVIEW"}
    except Exception as e:
        return {"scope_key": scope, "relation": relation, "source_page": source_page,
                "image_url": image_url, "status": "ERROR", "error": type(e).__name__ + ": " + str(e)[:180]}


def make_sheet(scope: str, rows: list[dict]):
    valid = [r for r in rows if r.get("status") == "DOWNLOADED_PENDING_VISUAL_REVIEW"][:24]
    if not valid:
        return None
    thumbs = []
    for r in valid:
        try:
            im = Image.open(r["local_path"]).convert("RGB")
            im.thumbnail((260, 260))
            tile = Image.new("RGB", (280, 320), "white")
            tile.paste(im, ((280-im.width)//2, 8))
            d = ImageDraw.Draw(tile)
            d.text((8, 276), Path(r["local_path"]).name[:32], fill="black")
            d.text((8, 294), f"{r.get('width')}x{r.get('height')}", fill="black")
            thumbs.append(tile)
        except Exception:
            pass
    if not thumbs:
        return None
    cols = 4
    rows_n = (len(thumbs)+cols-1)//cols
    sheet = Image.new("RGB", (cols*280, rows_n*320), "#dddddd")
    for i, tile in enumerate(thumbs):
        sheet.paste(tile, ((i%cols)*280, (i//cols)*320))
    out = SHEETS / (re.sub(r"[^A-Za-z0-9._-]+", "_", scope) + ".jpg")
    sheet.save(out, quality=88)
    return out.as_posix()


def main():
    captures, assets = [], []
    by_scope = defaultdict(list)
    for scope, relation, url in SEEDS:
        try:
            r = fetch(url)
            html = r.text
            captures.append({"scope_key": scope, "relation": relation, "source_page": url,
                             "final_url": str(r.url), "http_status": r.status_code,
                             "html_bytes": len(r.content), "candidate_image_urls": 0,
                             "captured_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat()})
            urls = candidate_image_urls(html, str(r.url))[:60]
            captures[-1]["candidate_image_urls"] = len(urls)
            for i, image_url in enumerate(urls, 1):
                row = save_image(scope, relation, url, image_url, i)
                assets.append(row)
                by_scope[scope].append(row)
        except Exception as e:
            captures.append({"scope_key": scope, "relation": relation, "source_page": url,
                             "http_status": 0, "error": type(e).__name__ + ": " + str(e)[:180]})
    for scope, relation, code, url in DIRECT_IMAGES:
        row = save_image(scope, relation, code, url, 1)
        assets.append(row)
        by_scope[scope].append(row)
    for scope, rows in by_scope.items():
        make_sheet(scope, rows)

    fields = sorted({k for r in captures for k in r})
    with (OUT/"source_capture.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w=csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(captures)
    fields = sorted({k for r in assets for k in r})
    with (OUT/"image_assets_pending_review.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w=csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(assets)
    manifest = {
        "run": "RLF_KB_W003B_EXACT_SOURCE_GALLERY_V1",
        "captured_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_pages": len(SEEDS),
        "direct_model_level_images": len(DIRECT_IMAGES),
        "asset_rows": len(assets),
        "downloaded_pending_visual_review": sum(r.get("status")=="DOWNLOADED_PENDING_VISUAL_REVIEW" for r in assets),
        "unique_binary_sha256": len({r.get("sha256") for r in assets if r.get("sha256")}),
        "canonical_promotions": 0,
        "note": "Exact-SKU gallery candidates and one model-level label image. No image role is accepted before visual review."
    }
    (OUT/"manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest))

if __name__ == "__main__":
    main()
