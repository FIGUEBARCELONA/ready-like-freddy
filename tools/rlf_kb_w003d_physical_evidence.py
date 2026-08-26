#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw, ImageOps

OUT = Path("w003d-physical-evidence")
IMG = OUT / "images"
HTML = OUT / "html"
SHEETS = OUT / "contact_sheets"
for p in (OUT, IMG, HTML, SHEETS):
    p.mkdir(parents=True, exist_ok=True)

DIRECT_IMAGES = [
    {
        "scope_key": "MODEL::M3600_S31",
        "evidence_scope": "MODEL_LEVEL_ONLY",
        "source_page": "https://www.ebay.com/itm/256699057073",
        "image_url": "https://i.ebayimg.com/images/g/aqQAAOSwOGJnJfFc/s-l1200.jpg",
        "expected_visible_text": "MADE IN CHINA M3600/S31/01885/409",
    },
    {
        "scope_key": "MODEL::M3600_E36",
        "evidence_scope": "MODEL_LEVEL_ONLY",
        "source_page": "https://www.ebay.co.uk/itm/175875557010",
        "image_url": "https://i.ebayimg.com/images/g/Na0AAOSwJBZk6eIL/s-l1200.jpg",
        "expected_visible_text": "MADE IN CHINA M3600/E36/01885/395",
    },
]

PAGE_TARGETS = [
    {
        "scope_key": "M3600::T60",
        "evidence_scope": "EXACT_VARIANT_PAGE",
        "url": "https://www.ebay.co.uk/itm/316401085772",
        "required_tokens": ["M3600", "T60"],
    },
    {
        "scope_key": "L7255::81A",
        "evidence_scope": "EXACT_VARIANT_PAGE",
        "url": "https://www.careofcarl.de/de/fred-perry-classic-barrel-bag-grassroots-green-ecru",
        "required_tokens": ["L7255", "81A", "5063460129686"],
    },
    {
        "scope_key": "FACTORY::SHILLA_GLOVIS_VN",
        "evidence_scope": "LEGAL_ENTITY_FACILITY_PAGE",
        "url": "https://shillabags.com/location-map/",
        "required_tokens": ["Shilla Glovis", "Cho Moi"],
    },
    {
        "scope_key": "FACTORY::WINZEN",
        "evidence_scope": "PRIMARY_BRAND_FACTORY_PAGE",
        "url": "https://www.fredperry.com/eu-es/subculture/articles/china-factory-winzen",
        "required_tokens": ["Winzen", "M3600", "Zhongshan"],
    },
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"

def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_")


def fetch(url: str, referer: str | None = None):
    headers = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
    if referer:
        headers["Referer"] = referer
    return requests.get(url, headers=headers, impersonate="chrome", timeout=25, allow_redirects=True)


rows: list[dict] = []

# Direct model-level label references.
for i, target in enumerate(DIRECT_IMAGES, 1):
    try:
        r = fetch(target["image_url"], target["source_page"])
        content_type = r.headers.get("content-type", "")
        data = bytes(r.content)
        ext = ".jpg" if "jpeg" in content_type or data[:2] == b"\xff\xd8" else ".bin"
        path = IMG / f"direct_{i:02d}_{safe_name(target['scope_key'])}{ext}"
        path.write_bytes(data)
        width = height = 0
        valid_image = False
        try:
            with Image.open(path) as im:
                im.verify()
            with Image.open(path) as im:
                width, height = im.size
            valid_image = True
        except Exception:
            pass
        rows.append({
            **target,
            "capture_type": "DIRECT_IMAGE",
            "http_status": r.status_code,
            "final_url": str(r.url),
            "content_type": content_type,
            "bytes": len(data),
            "width": width,
            "height": height,
            "sha256": sha256(data),
            "valid_image": valid_image,
            "local_path": path.as_posix(),
            "captured_at_utc": now(),
            "review_status": "PENDING_VISUAL_REVIEW",
        })
    except Exception as exc:
        rows.append({**target, "capture_type": "DIRECT_IMAGE", "error": repr(exc), "captured_at_utc": now(), "review_status": "FETCH_FAILED"})

# Exact pages and bounded image candidates.
for target in PAGE_TARGETS:
    try:
        r = fetch(target["url"])
        html = r.text
        html_path = HTML / f"{safe_name(target['scope_key'])}.html"
        html_path.write_text(html, encoding="utf-8", errors="replace")
        lower = html.lower()
        token_hits = {tok: (tok.lower() in lower) for tok in target["required_tokens"]}
        rows.append({
            **target,
            "capture_type": "PAGE_HTML",
            "http_status": r.status_code,
            "final_url": str(r.url),
            "content_type": r.headers.get("content-type", ""),
            "bytes": len(r.content),
            "sha256": sha256(bytes(r.content)),
            "token_hits_json": json.dumps(token_hits, ensure_ascii=False),
            "all_required_tokens_present": all(token_hits.values()),
            "local_path": html_path.as_posix(),
            "captured_at_utc": now(),
            "review_status": "CAPTURED",
        })
        soup = BeautifulSoup(html, "html.parser")
        candidates: list[str] = []
        for tag in soup.find_all(["img", "source"]):
            for attr in ("src", "data-src", "data-lazy", "srcset", "data-srcset"):
                raw = tag.get(attr)
                if not raw:
                    continue
                for part in str(raw).split(","):
                    u = part.strip().split(" ")[0]
                    if not u:
                        continue
                    u = urllib.parse.urljoin(str(r.url), u)
                    if u.startswith("http") and u not in candidates:
                        candidates.append(u)
        candidates = candidates[:24]
        for idx, u in enumerate(candidates, 1):
            try:
                ir = fetch(u, str(r.url))
                data = bytes(ir.content)
                ct = ir.headers.get("content-type", "")
                if ir.status_code != 200 or not (ct.startswith("image/") or data[:2] == b"\xff\xd8" or data[:8] == b"\x89PNG\r\n\x1a\n"):
                    continue
                ext = ".jpg" if "jpeg" in ct or data[:2] == b"\xff\xd8" else ".png" if "png" in ct else ".webp" if "webp" in ct else ".img"
                path = IMG / f"{safe_name(target['scope_key'])}_{idx:02d}_{sha256(data)[:12]}{ext}"
                path.write_bytes(data)
                width = height = 0
                valid = False
                try:
                    with Image.open(path) as im:
                        im.verify()
                    with Image.open(path) as im:
                        width, height = im.size
                    valid = True
                except Exception:
                    pass
                if not valid or width < 300 or height < 300:
                    continue
                rows.append({
                    **target,
                    "capture_type": "PAGE_IMAGE_CANDIDATE",
                    "source_page": target["url"],
                    "image_url": u,
                    "http_status": ir.status_code,
                    "final_url": str(ir.url),
                    "content_type": ct,
                    "bytes": len(data),
                    "width": width,
                    "height": height,
                    "sha256": sha256(data),
                    "valid_image": valid,
                    "local_path": path.as_posix(),
                    "captured_at_utc": now(),
                    "review_status": "PENDING_VISUAL_REVIEW",
                })
            except Exception:
                continue
    except Exception as exc:
        rows.append({**target, "capture_type": "PAGE_HTML", "error": repr(exc), "captured_at_utc": now(), "review_status": "FETCH_FAILED"})

fields = sorted({k for row in rows for k in row})
with (OUT / "evidence_capture.csv").open("w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader(); w.writerows(rows)

# Contact sheets for every scope with valid images.
by_scope: dict[str, list[dict]] = {}
for row in rows:
    if row.get("valid_image") is True and row.get("local_path"):
        by_scope.setdefault(row["scope_key"], []).append(row)
for scope, items in by_scope.items():
    thumbs = []
    for row in items[:20]:
        try:
            im = Image.open(row["local_path"]).convert("RGB")
            im.thumbnail((280, 280))
            canvas = Image.new("RGB", (300, 330), "white")
            canvas.paste(im, ((300-im.width)//2, 5))
            d = ImageDraw.Draw(canvas)
            label = f"{Path(row['local_path']).name}\n{row.get('width')}x{row.get('height')}"
            d.multiline_text((8, 290), label, fill="black")
            thumbs.append(canvas)
        except Exception:
            pass
    if thumbs:
        cols = 4; rows_n = (len(thumbs)+cols-1)//cols
        sheet = Image.new("RGB", (cols*300, rows_n*330), "white")
        for i, im in enumerate(thumbs):
            sheet.paste(im, ((i%cols)*300, (i//cols)*330))
        sheet.save(SHEETS / f"{safe_name(scope)}.jpg", quality=88)

manifest = {
    "version": "W003D_PHYSICAL_EVIDENCE_V1",
    "captured_at_utc": now(),
    "records": len(rows),
    "direct_targets": len(DIRECT_IMAGES),
    "page_targets": len(PAGE_TARGETS),
    "valid_images": sum(1 for r in rows if r.get("valid_image") is True),
    "policy": "APPEND_ONLY_FAIL_CLOSED",
    "automatic_role_promotion": False,
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps(manifest))
