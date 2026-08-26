#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw, ImageFont

OUT = Path("w003e-mercari-physical")
IMG = OUT / "images"
SHEETS = OUT / "contact_sheets"
OUT.mkdir(exist_ok=True)
IMG.mkdir(exist_ok=True)
SHEETS.mkdir(exist_ok=True)

@dataclass(frozen=True)
class Target:
    scope_key: str
    url: str
    evidence_scope: str
    expected_tokens: tuple[str, ...]

TARGETS = [
    Target("M3600::U98", "https://jp.mercari.com/item/m39961445165", "EXACT_PHYSICAL_LISTING", ("M3600", "U98")),
    Target("M3600::T60", "https://jp.mercari.com/item/m76909864831", "EXACT_PHYSICAL_LISTING", ("M3600", "T60")),
    Target("M3600::350", "https://jp.mercari.com/item/m94021662173", "EXACT_PHYSICAL_LISTING", ("M3600", "350")),
    Target("M3600::350", "https://jp.mercari.com/shops/product/ki9WFAu2s2rJTAQz882yiV", "EXACT_PHYSICAL_SHOP_LISTING", ("M3600", "350", "1950", "419")),
    Target("M3600::350", "https://jp.mercari.com/shops/product/2JRbhzFBfvdE7H9w7nbrcG", "EXACT_PHYSICAL_SHOP_LISTING", ("M3600", "350", "1950", "396")),
    Target("M3600::T50", "https://jp.mercari.com/shops/product/7i5pcKHJ39Seh8momvAYT3", "EXACT_NEW_STOCK_LISTING", ("M3600", "T50")),
    Target("M3600::T60", "https://jp.mercari.com/shops/product/NiemYZ8XfmY8WU3GUgzsdJ", "EXACT_NEW_STOCK_LISTING", ("M3600", "T60")),
    Target("M3600::U98", "https://jp.mercari.com/shops/product/mG3RbWtyVNkJyn3DdRT83n", "EXACT_NEW_STOCK_LISTING", ("M3600", "U98")),
    Target("M3600::T50", "https://www.feelway.com/gv_FRED_8238999931.html", "EXACT_RESALE_LISTING", ("M3600", "T50")),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
SESSION = requests.Session(impersonate="chrome")
HEADERS = {"user-agent": UA, "accept-language": "ja,en-US;q=0.9,en;q=0.8"}

MERCARI_PATTERNS = [
    r"https:\\/\\/static\.mercdn\.net\\/item\\/detail\\/orig\\/photos\\/[^\"'\\\s]+",
    r"https://static\.mercdn\.net/item/detail/orig/photos/[^\"'<>\s]+",
    r"https:\\/\\/static\.mercdn\.net\\/item\\/detail\\/photos\\/[^\"'\\\s]+",
    r"https://static\.mercdn\.net/item/detail/photos/[^\"'<>\s]+",
    r"https:\\/\\/static\.mercdn\.net\\/c!\\/[^\"'\\\s]+",
    r"https://static\.mercdn\.net/c!/[^\"'<>\s]+",
]
GENERIC_IMAGE_RE = re.compile(r"https?://[^\"'<>\s]+\.(?:jpe?g|png|webp)(?:\?[^\"'<>\s]*)?", re.I)
CODE_RE = re.compile(r"M3600[\s/_-]*(?:04C|85B|87B|T50|T60|U98|350)(?:[\s/_-]*[0-9A-Z]{2,8}){0,3}", re.I)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_url(value: str, base: str) -> str:
    value = html.unescape(value).replace("\\/", "/").replace("\\u0026", "&")
    return urljoin(base, value)


def extract_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript"]):
        tag.extract()
    return "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())


def extract_title(soup: BeautifulSoup) -> str:
    for attr in [("meta", {"property": "og:title"}), ("meta", {"name": "twitter:title"})]:
        tag = soup.find(*attr)
        if tag and tag.get("content"):
            return tag["content"].strip()
    return soup.title.get_text(" ", strip=True) if soup.title else ""


def extract_description(soup: BeautifulSoup) -> str:
    for attr in [("meta", {"property": "og:description"}), ("meta", {"name": "description"})]:
        tag = soup.find(*attr)
        if tag and tag.get("content"):
            return tag["content"].strip()
    return ""


def extract_images(raw: str, soup: BeautifulSoup, base_url: str) -> list[str]:
    values: list[str] = []
    for pattern in MERCARI_PATTERNS:
        values.extend(re.findall(pattern, raw, re.I))
    for tag in soup.find_all(["img", "source", "meta"]):
        for attr in ("src", "srcset", "data-src", "data-original", "content"):
            value = tag.get(attr)
            if not value:
                continue
            if attr == "srcset":
                for item in value.split(","):
                    values.append(item.strip().split(" ")[0])
            else:
                values.append(value)
    values.extend(GENERIC_IMAGE_RE.findall(raw))

    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        url = normalize_url(value, base_url)
        if not url.startswith("http"):
            continue
        lower = url.lower()
        if any(x in lower for x in ("logo", "icon", "sprite", "avatar", "favicon", "tracking", "analytics")):
            continue
        if "mercdn.net" not in lower and urlparse(base_url).netloc not in urlparse(url).netloc:
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out[:40]


def fetch_page(target: Target) -> tuple[int, str, str]:
    try:
        response = SESSION.get(target.url, headers=HEADERS, timeout=35, allow_redirects=True)
        return response.status_code, str(response.url), response.text
    except Exception as exc:
        return 0, target.url, f"FETCH_ERROR: {type(exc).__name__}: {exc}"


def download_image(url: str) -> tuple[str, bytes, str]:
    try:
        response = SESSION.get(url, headers={**HEADERS, "referer": "https://jp.mercari.com/"}, timeout=30)
        mime = response.headers.get("content-type", "").split(";")[0]
        if response.status_code != 200:
            return f"HTTP_{response.status_code}", b"", mime
        return "DOWNLOADED", response.content, mime
    except Exception as exc:
        return f"ERROR_{type(exc).__name__}", b"", ""


def contact_sheet(scope_key: str, image_paths: list[Path]) -> None:
    thumbs = []
    for path in image_paths[:24]:
        try:
            im = Image.open(path).convert("RGB")
            im.thumbnail((260, 220))
            thumbs.append((path, im.copy()))
        except Exception:
            continue
    if not thumbs:
        return
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * 280, rows * 260 + 50), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 10), scope_key, fill="black")
    for index, (path, im) in enumerate(thumbs):
        x = (index % cols) * 280 + 10
        y = (index // cols) * 260 + 40
        canvas.paste(im, (x, y))
        draw.text((x, y + 222), f"{index+1:02d} {path.name[:30]}", fill="black")
    canvas.save(SHEETS / f"{scope_key.replace('::', '_')}.jpg", quality=88)


def main() -> int:
    page_rows: list[dict] = []
    asset_rows: list[dict] = []
    code_rows: list[dict] = []
    exact_scope_paths: dict[str, list[Path]] = {}
    global_sha: dict[str, str] = {}

    for target_index, target in enumerate(TARGETS, 1):
        status, final_url, raw = fetch_page(target)
        soup = BeautifulSoup(raw, "html.parser")
        title = extract_title(soup)
        description = extract_description(soup)
        text = extract_text(soup)
        combined = "\n".join([title, description, text])
        token_hits = [token for token in target.expected_tokens if token.lower() in combined.lower()]
        codes = sorted(set(m.group(0).replace(" ", "") for m in CODE_RE.finditer(combined)))
        for code in codes:
            code_rows.append({
                "scope_key": target.scope_key,
                "source_url": target.url,
                "observed_code": code,
                "evidence_scope": target.evidence_scope,
                "captured_at_utc": now(),
            })
        image_urls = extract_images(raw, soup, final_url)
        page_rows.append({
            "scope_key": target.scope_key,
            "evidence_scope": target.evidence_scope,
            "source_url": target.url,
            "final_url": final_url,
            "http_status": status,
            "title": title,
            "description": description,
            "expected_tokens": "|".join(target.expected_tokens),
            "token_hits": "|".join(token_hits),
            "all_expected_tokens_present": str(len(token_hits) == len(target.expected_tokens)).upper(),
            "observed_codes": "|".join(codes),
            "candidate_image_urls": len(image_urls),
            "page_sha256": sha256(raw.encode("utf-8", errors="ignore")),
            "captured_at_utc": now(),
        })

        scope_dir = IMG / target.scope_key.replace("::", "__")
        scope_dir.mkdir(exist_ok=True)
        exact_scope_paths.setdefault(target.scope_key, [])
        for ordinal, image_url in enumerate(image_urls, 1):
            dl_status, data, mime = download_image(image_url)
            row = {
                "scope_key": target.scope_key,
                "evidence_scope": target.evidence_scope,
                "source_url": target.url,
                "final_page_url": final_url,
                "ordinal": ordinal,
                "image_url": image_url,
                "download_status": dl_status,
                "mime": mime,
                "bytes": len(data),
                "sha256": "",
                "width": "",
                "height": "",
                "local_path": "",
                "binary_duplicate_of": "",
                "captured_at_utc": now(),
            }
            if dl_status == "DOWNLOADED" and data:
                digest = sha256(data)
                row["sha256"] = digest
                row["binary_duplicate_of"] = global_sha.get(digest, "")
                if digest not in global_sha:
                    ext = ".jpg"
                    if "png" in mime:
                        ext = ".png"
                    elif "webp" in mime:
                        ext = ".webp"
                    path = scope_dir / f"{target_index:02d}_{ordinal:02d}_{digest[:12]}{ext}"
                    try:
                        image = Image.open(io.BytesIO(data))
                        row["width"], row["height"] = image.size
                        image.verify()
                        path.write_bytes(data)
                        row["local_path"] = path.as_posix()
                        global_sha[digest] = path.as_posix()
                        exact_scope_paths[target.scope_key].append(path)
                    except Exception:
                        row["download_status"] = "INVALID_IMAGE_BYTES"
                else:
                    row["local_path"] = global_sha[digest]
            asset_rows.append(row)

    for scope_key, paths in exact_scope_paths.items():
        contact_sheet(scope_key, paths)

    def write_csv(name: str, rows: list[dict]) -> None:
        path = OUT / name
        headers = sorted({key for row in rows for key in row}) if rows else []
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)

    write_csv("page_capture.csv", page_rows)
    write_csv("image_assets_pending_review.csv", asset_rows)
    write_csv("observed_code_strings.csv", code_rows)

    downloaded = [r for r in asset_rows if r["download_status"] == "DOWNLOADED"]
    manifest = {
        "created_at_utc": now(),
        "policy": "APPEND_ONLY_FAIL_CLOSED",
        "targets": len(TARGETS),
        "pages_http_200": sum(1 for r in page_rows if r["http_status"] == 200),
        "asset_rows": len(asset_rows),
        "downloaded_unique_images": sum(1 for r in downloaded if not r["binary_duplicate_of"]),
        "duplicate_binary_rows": sum(1 for r in asset_rows if r["binary_duplicate_of"]),
        "observed_code_strings": len(code_rows),
        "automatic_role_promotions": 0,
        "automatic_canonical_promotions": 0,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / "README.md").write_text(
        "# W003E Mercari physical evidence collector\n\n"
        "Raw physical-listing evidence only. No image is assigned to a forensic role before visual review.\n",
        encoding="utf-8",
    )

    checksum_lines = []
    for path in sorted(p for p in OUT.rglob("*") if p.is_file() and p.name != "SHA256SUMS.txt"):
        checksum_lines.append(f"{sha256(path.read_bytes())}  {path.relative_to(OUT).as_posix()}")
    (OUT / "SHA256SUMS.txt").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
