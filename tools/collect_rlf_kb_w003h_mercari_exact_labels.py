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
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw

OUT = Path("w003h-mercari-exact-labels")
IMG = OUT / "images"
RAW = OUT / "raw_pages"
SHEETS = OUT / "contact_sheets"
for path in (OUT, IMG, RAW, SHEETS):
    path.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
SESSION = requests.Session(impersonate="chrome")
HEADERS = {"user-agent": UA, "accept-language": "ja,en-US;q=0.9,en;q=0.8"}
ITEM_RE = re.compile(r"https?://jp\.mercari\.com/item/(m\d+)|/item/(m\d+)", re.I)
URL_RE = re.compile(r"https?:\\?/\\?/[^\"'<>\\\s]+", re.I)

EXCLUDED_ITEM_IDS = {
    "m39961445165",  # U98 already reviewed in W003G
    "m94021662173",  # 350/421 already reviewed in W003G
}

@dataclass(frozen=True)
class Scope:
    scope_key: str
    colour_token: str
    max_items: int = 8

SCOPES = [
    Scope("M3600::04C", "04C"),
    Scope("M3600::85B", "85B"),
    Scope("M3600::87B", "87B"),
    Scope("M3600::T50", "T50"),
    Scope("M3600::T60", "T60"),
    Scope("M3600::U98", "U98", 5),
    Scope("M3600::350", "350", 5),
]

KNOWN_ITEMS = {
    "M3600::T60": ["m76909864831"],
}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, referer: str = ""):
    headers = dict(HEADERS)
    if referer:
        headers["referer"] = referer
    return SESSION.get(url, headers=headers, timeout=35, allow_redirects=True)


def item_sequence(item_id: str) -> list[str]:
    return [
        f"https://static.mercdn.net/item/detail/orig/photos/{item_id}_{ordinal}.jpg"
        for ordinal in range(1, 25)
    ]


def extract_item_ids(raw: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for match in ITEM_RE.finditer(raw):
        item_id = match.group(1) or match.group(2)
        if item_id and item_id not in seen:
            seen.add(item_id)
            ids.append(item_id)
    try:
        decoded = bytes(raw, "utf-8").decode("unicode_escape", errors="ignore")
        for match in ITEM_RE.finditer(decoded):
            item_id = match.group(1) or match.group(2)
            if item_id and item_id not in seen:
                seen.add(item_id)
                ids.append(item_id)
    except Exception:
        pass
    return ids


def compact_text(raw: str) -> str:
    soup = BeautifulSoup(raw, "html.parser")
    text = " ".join(soup.stripped_strings)
    return re.sub(r"\s+", " ", html.unescape(text))


def exact_page_match(text: str, colour_token: str) -> bool:
    upper = text.upper()
    if "M3600" not in upper or colour_token.upper() not in upper:
        return False
    # Exclude search/list pages accidentally fetched as item pages.
    return "商品" in text or "FRED PERRY" in upper or "フレッドペリー" in text


def page_image_urls(raw: str) -> list[str]:
    values = URL_RE.findall(raw)
    try:
        decoded = bytes(raw, "utf-8").decode("unicode_escape", errors="ignore")
        values.extend(URL_RE.findall(decoded))
    except Exception:
        pass
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        url = html.unescape(value).replace("\\/", "/").replace("\\u0026", "&")
        if "static.mercdn.net/item/detail/orig/photos/" not in url:
            continue
        url = url.rstrip("\\")
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


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
        if width < 350 or height < 350 or len(data) < 15000:
            return "REJECT_SMALL", data, mime, width, height
        return "DOWNLOADED", data, mime, width, height
    except Exception as exc:
        return f"ERROR_{type(exc).__name__}", b"", "", 0, 0


def write_csv(name: str, rows: list[dict]) -> None:
    headers = sorted({key for row in rows for key in row}) if rows else []
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def create_contact_sheet(scope_key: str, paths: list[Path]) -> None:
    thumbs = []
    for path in paths[:72]:
        try:
            image = Image.open(path).convert("RGB")
            image.thumbnail((250, 205))
            thumbs.append((path, image.copy()))
        except Exception:
            continue
    if not thumbs:
        return
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * 270, rows * 245 + 48), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 12), scope_key, fill="black")
    for index, (path, image) in enumerate(thumbs):
        x = (index % cols) * 270 + 10
        y = (index // cols) * 245 + 38
        canvas.paste(image, (x, y))
        draw.text((x, y + 207), path.name[:34], fill="black")
    canvas.save(SHEETS / f"{scope_key.replace('::', '__')}.jpg", quality=88)


def main() -> int:
    discovery_rows: list[dict] = []
    item_rows: list[dict] = []
    asset_rows: list[dict] = []
    global_sha: dict[str, str] = {}
    paths_by_scope: dict[str, list[Path]] = {}

    for scope_index, scope in enumerate(SCOPES, 1):
        search_url = f"https://jp.mercari.com/search?keyword={quote('M3600 ' + scope.colour_token)}"
        search_status = 0
        search_raw = ""
        try:
            response = fetch(search_url)
            search_status = response.status_code
            search_raw = response.text
        except Exception as exc:
            search_raw = f"FETCH_ERROR {type(exc).__name__}: {exc}"
        search_path = RAW / f"search_{scope_index:02d}_{scope.scope_key.replace('::','__')}.html"
        search_path.write_text(search_raw, encoding="utf-8", errors="ignore")

        discovered = []
        for item_id in KNOWN_ITEMS.get(scope.scope_key, []):
            if item_id not in discovered:
                discovered.append(item_id)
        for item_id in extract_item_ids(search_raw):
            if item_id in EXCLUDED_ITEM_IDS or item_id in discovered:
                continue
            discovered.append(item_id)
            if len(discovered) >= scope.max_items:
                break

        discovery_rows.append({
            "scope_key": scope.scope_key,
            "colour_token": scope.colour_token,
            "search_url": search_url,
            "search_http_status": search_status,
            "discovered_item_ids": len(discovered),
            "item_ids": ";".join(discovered),
            "search_page_sha256": sha256(search_raw.encode("utf-8", errors="ignore")),
            "captured_at_utc": now(),
        })

        paths_by_scope.setdefault(scope.scope_key, [])
        accepted_count = 0
        for item_index, item_id in enumerate(discovered, 1):
            item_url = f"https://jp.mercari.com/item/{item_id}"
            status = 0
            raw = ""
            final_url = item_url
            try:
                response = fetch(item_url, search_url)
                status = response.status_code
                final_url = str(response.url)
                raw = response.text
            except Exception as exc:
                raw = f"FETCH_ERROR {type(exc).__name__}: {exc}"

            raw_path = RAW / f"item_{scope_index:02d}_{item_index:02d}_{item_id}.html"
            raw_path.write_text(raw, encoding="utf-8", errors="ignore")
            text = compact_text(raw)
            accepted = status == 200 and exact_page_match(text, scope.colour_token)
            item_rows.append({
                "scope_key": scope.scope_key,
                "colour_token": scope.colour_token,
                "item_id": item_id,
                "item_url": item_url,
                "http_status": status,
                "final_url": final_url,
                "exact_page_match": "YES" if accepted else "NO",
                "page_text_preview": text[:500],
                "page_sha256": sha256(raw.encode("utf-8", errors="ignore")),
                "raw_page_path": raw_path.as_posix(),
                "captured_at_utc": now(),
            })
            if not accepted:
                continue
            accepted_count += 1

            urls = item_sequence(item_id) + page_image_urls(raw)
            ordered_urls: list[str] = []
            seen_urls: set[str] = set()
            for url in urls:
                if url not in seen_urls:
                    seen_urls.add(url)
                    ordered_urls.append(url)

            item_dir = IMG / f"{scope_index:02d}_{scope.scope_key.replace('::','__')}" / item_id
            item_dir.mkdir(parents=True, exist_ok=True)
            for ordinal, url in enumerate(ordered_urls[:50], 1):
                dl_status, data, mime, width, height = download_image(url, item_url)
                row = {
                    "scope_key": scope.scope_key,
                    "colour_token": scope.colour_token,
                    "item_id": item_id,
                    "item_url": item_url,
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
                        path = item_dir / f"{ordinal:03d}_{digest[:12]}{ext}"
                        path.write_bytes(data)
                        row["local_path"] = path.as_posix()
                        global_sha[digest] = path.as_posix()
                        paths_by_scope[scope.scope_key].append(path)
                    else:
                        row["local_path"] = global_sha[digest]
                asset_rows.append(row)

        # Preserve accepted-count in a separate summary row because search results may be noisy.
        discovery_rows[-1]["accepted_exact_item_pages"] = accepted_count

    for scope_key, paths in paths_by_scope.items():
        create_contact_sheet(scope_key, paths)

    write_csv("search_discovery.csv", discovery_rows)
    write_csv("item_pages.csv", item_rows)
    write_csv("image_assets_pending_review.csv", asset_rows)

    manifest = {
        "created_at_utc": now(),
        "policy": "APPEND_ONLY_FAIL_CLOSED",
        "scopes": len(SCOPES),
        "search_pages_http_200": sum(1 for row in discovery_rows if row["search_http_status"] == 200),
        "discovered_item_ids": sum(int(row["discovered_item_ids"]) for row in discovery_rows),
        "accepted_exact_item_pages": sum(int(row["accepted_exact_item_pages"]) for row in discovery_rows),
        "asset_attempts": len(asset_rows),
        "downloaded_unique_images": sum(
            1 for row in asset_rows
            if row["download_status"] == "DOWNLOADED" and not row["binary_duplicate_of"]
        ),
        "downloaded_duplicate_images": sum(
            1 for row in asset_rows
            if row["download_status"] == "DOWNLOADED" and row["binary_duplicate_of"]
        ),
        "excluded_previously_reviewed_item_ids": sorted(EXCLUDED_ITEM_IDS),
        "role_promotions": 0,
        "visual_review_required": True,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUT / "README.md").write_text(
        "# W003H Mercari exact-label collector\n\n"
        "Search results are accepted only when the item page itself contains M3600 and the exact colour token. "
        "All images remain pending controlled visual review; no forensic role or production variant is promoted automatically.\n",
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
