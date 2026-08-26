#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw

OUT = Path("w003g-exact-physical-galleries")
IMG = OUT / "images"
SHEETS = OUT / "contact_sheets"
RAW = OUT / "raw_pages"
for p in (OUT, IMG, SHEETS, RAW):
    p.mkdir(exist_ok=True)

@dataclass(frozen=True)
class Target:
    scope_key: str
    source_url: str
    full_code: str
    source_type: str
    mercari_item_id: str = ""

TARGETS = [
    Target("M3600::U98", "https://jp.mercari.com/item/m39961445165", "M3600/U98/1950/418", "MERCARI_ITEM", "m39961445165"),
    Target("M3600::350", "https://jp.mercari.com/item/m94021662173", "", "MERCARI_ITEM", "m94021662173"),
    Target("M3600::U98", "https://vector-park.jp/item/081-102608070402/", "M3600/U98/1950/418", "VECTOR"),
    Target("M3600::350", "https://www.trefac.jp/store/3083001182033315/c3319816/", "M3600/350/1950/419", "TREFAC"),
    Target("M3600::350", "https://www.trefac.jp/store/1024006925272028/c3748760/", "M3600/350/1950/419", "TREFAC"),
    Target("M3600::350", "https://www.trefac.jp/store/1019008976582418/c3224779/", "M3600/350/1950/396", "TREFAC"),
    Target("M3600::350", "https://ec.bazzstore.com/products/1132871260593", "M3600/350/1950/396", "BAZZSTORE"),
    Target("M3600::T50", "https://www.feelway.com/gv_FRED_8238999931.html", "", "FEELWAY"),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
SESSION = requests.Session(impersonate="chrome")
HEADERS = {"user-agent": UA, "accept-language": "ja,en-US;q=0.9,en;q=0.8"}
IMAGE_EXT = re.compile(r"\.(?:jpe?g|png|webp)(?:\?|$)", re.I)
URL_RE = re.compile(r"https?:\\?/\\?/[^\"'<>\\\s]+", re.I)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_url(value: str, base: str) -> str:
    value = html.unescape(value)
    value = value.replace("\\/", "/").replace("\\u0026", "&").replace("\\u003d", "=")
    value = value.rstrip("\\")
    return urljoin(base, value)


def fetch(url: str, referer: str = ""):
    headers = dict(HEADERS)
    if referer:
        headers["referer"] = referer
    return SESSION.get(url, headers=headers, timeout=35, allow_redirects=True)


def page_candidate_urls(raw: str, final_url: str) -> list[str]:
    soup = BeautifulSoup(raw, "html.parser")
    values: list[str] = []
    for tag in soup.find_all(["img", "source", "meta", "a"]):
        for attr in ("src", "srcset", "data-src", "data-original", "data-lazy", "content", "href"):
            value = tag.get(attr)
            if not value:
                continue
            if attr == "srcset":
                values.extend(part.strip().split(" ")[0] for part in value.split(","))
            else:
                values.append(value)
    values.extend(URL_RE.findall(raw))
    # Recover quoted JSON strings after one unescape pass.
    try:
        decoded = bytes(raw, "utf-8").decode("unicode_escape", errors="ignore")
        values.extend(URL_RE.findall(decoded))
    except Exception:
        pass

    allowed_hosts = {
        "static.mercdn.net", "assets.mercari-shops-static.com",
        "vector-park.jp", "www.vector-park.jp", "img.vector-park.jp",
        "www.trefac.jp", "cdn.trefac.jp", "trefac-image.s3.ap-northeast-1.amazonaws.com",
        "ec.bazzstore.com", "cdn.shopify.com", "baseec-img-mng.akamaized.net",
        "www.feelway.com", "image.feelway.com", "img.feelway.com",
    }
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        url = normalize_url(value, final_url)
        if not url.startswith("http") or not IMAGE_EXT.search(url):
            continue
        host = urlparse(url).netloc.lower()
        if host not in allowed_hosts and not any(host.endswith("." + h) for h in allowed_hosts):
            continue
        lower = url.lower()
        if any(token in lower for token in ("logo", "icon", "sprite", "avatar", "favicon", "tracking", "loading", "noimage")):
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out[:160]


def mercari_sequence(item_id: str) -> list[str]:
    return [f"https://static.mercdn.net/item/detail/orig/photos/{item_id}_{i}.jpg" for i in range(1, 31)]


def download_image(url: str, referer: str):
    try:
        response = fetch(url, referer)
        mime = response.headers.get("content-type", "").split(";")[0].lower()
        if response.status_code != 200:
            return f"HTTP_{response.status_code}", b"", mime, 0, 0
        data = response.content
        image = Image.open(io.BytesIO(data))
        width, height = image.size
        image.verify()
        if width < 300 or height < 300 or len(data) < 12000:
            return "REJECT_SMALL", data, mime, width, height
        return "DOWNLOADED", data, mime, width, height
    except Exception as exc:
        return f"ERROR_{type(exc).__name__}", b"", "", 0, 0


def contact_sheet(scope_key: str, paths: list[Path]) -> None:
    thumbs = []
    for path in paths[:40]:
        try:
            im = Image.open(path).convert("RGB")
            im.thumbnail((250, 210))
            thumbs.append((path, im.copy()))
        except Exception:
            continue
    if not thumbs:
        return
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * 270, rows * 250 + 45), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 10), scope_key, fill="black")
    for idx, (path, im) in enumerate(thumbs):
        x = (idx % cols) * 270 + 10
        y = (idx // cols) * 250 + 35
        canvas.paste(im, (x, y))
        draw.text((x, y + 213), f"{idx+1:02d} {path.name[:28]}", fill="black")
    canvas.save(SHEETS / f"{scope_key.replace('::', '__')}.jpg", quality=88)


def write_csv(name: str, rows: list[dict]) -> None:
    headers = sorted({k for row in rows for k in row}) if rows else []
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    page_rows: list[dict] = []
    asset_rows: list[dict] = []
    scope_paths: dict[str, list[Path]] = {}
    global_sha: dict[str, str] = {}

    for target_index, target in enumerate(TARGETS, 1):
        status = 0
        final_url = target.source_url
        raw = ""
        try:
            response = fetch(target.source_url)
            status = response.status_code
            final_url = str(response.url)
            raw = response.text
        except Exception as exc:
            raw = f"FETCH_ERROR {type(exc).__name__}: {exc}"
        raw_path = RAW / f"{target_index:02d}_{target.scope_key.replace('::','__')}.html"
        raw_path.write_text(raw, encoding="utf-8", errors="ignore")

        urls = page_candidate_urls(raw, final_url)
        if target.mercari_item_id:
            urls = mercari_sequence(target.mercari_item_id) + urls
        # Preserve order, remove duplicate URLs.
        deduped = []
        seen = set()
        for url in urls:
            if url not in seen:
                seen.add(url)
                deduped.append(url)
        urls = deduped[:180]

        page_rows.append({
            "scope_key": target.scope_key,
            "source_url": target.source_url,
            "source_type": target.source_type,
            "full_code": target.full_code,
            "http_status": status,
            "final_url": final_url,
            "candidate_image_urls": len(urls),
            "page_sha256": sha256(raw.encode("utf-8", errors="ignore")),
            "raw_page_path": raw_path.as_posix(),
            "captured_at_utc": now(),
        })

        scope_dir = IMG / f"{target_index:02d}_{target.scope_key.replace('::','__')}"
        scope_dir.mkdir(exist_ok=True)
        scope_paths.setdefault(target.scope_key, [])
        for ordinal, url in enumerate(urls, 1):
            dl_status, data, mime, width, height = download_image(url, target.source_url)
            row = {
                "scope_key": target.scope_key,
                "source_url": target.source_url,
                "source_type": target.source_type,
                "full_code": target.full_code,
                "ordinal": ordinal,
                "image_url": url,
                "download_status": dl_status,
                "mime": mime,
                "bytes": len(data),
                "width": width or "",
                "height": height or "",
                "sha256": "",
                "binary_duplicate_of": "",
                "local_path": "",
                "captured_at_utc": now(),
            }
            if dl_status == "DOWNLOADED":
                digest = sha256(data)
                row["sha256"] = digest
                row["binary_duplicate_of"] = global_sha.get(digest, "")
                if digest not in global_sha:
                    ext = ".png" if "png" in mime else ".webp" if "webp" in mime else ".jpg"
                    path = scope_dir / f"{ordinal:03d}_{digest[:12]}{ext}"
                    path.write_bytes(data)
                    row["local_path"] = path.as_posix()
                    global_sha[digest] = path.as_posix()
                    scope_paths[target.scope_key].append(path)
                else:
                    row["local_path"] = global_sha[digest]
            asset_rows.append(row)

    for scope, paths in scope_paths.items():
        contact_sheet(scope, paths)

    write_csv("page_capture.csv", page_rows)
    write_csv("image_assets_pending_review.csv", asset_rows)
    manifest = {
        "created_at_utc": now(),
        "policy": "APPEND_ONLY_FAIL_CLOSED",
        "targets": len(TARGETS),
        "pages_http_200": sum(1 for r in page_rows if r["http_status"] == 200),
        "asset_attempts": len(asset_rows),
        "downloaded_unique_images": sum(1 for r in asset_rows if r["download_status"] == "DOWNLOADED" and not r["binary_duplicate_of"]),
        "downloaded_duplicate_images": sum(1 for r in asset_rows if r["download_status"] == "DOWNLOADED" and r["binary_duplicate_of"]),
        "role_promotions": 0,
        "visual_review_required": True,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUT / "README.md").write_text(
        "# W003G exact physical gallery collector\n\nAll downloaded images remain pending controlled visual review. No role or production variant is promoted by this collector.\n",
        encoding="utf-8",
    )
    checks = []
    for path in sorted(p for p in OUT.rglob("*") if p.is_file() and p.name != "SHA256SUMS.txt"):
        checks.append(f"{sha256(path.read_bytes())}  {path.relative_to(OUT).as_posix()}")
    (OUT / "SHA256SUMS.txt").write_text("\n".join(checks) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
