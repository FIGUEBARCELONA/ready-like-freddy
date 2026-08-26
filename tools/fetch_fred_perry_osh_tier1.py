#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

BASE = "https://opensupplyhub.org"
CONTRIBUTOR_ID = 1092
OUT = Path("osh-fred-perry-tier1")
OUT.mkdir(parents=True, exist_ok=True)

session = requests.Session()
session.headers.update({
    "User-Agent": "RLF-Fred-Perry-KB/1.0 (+research; auditable)",
    "Accept": "application/json",
})


def get_json(path: str, params: dict[str, Any] | None = None) -> tuple[int, Any, str]:
    url = BASE + path
    try:
        response = session.get(url, params=params, timeout=90)
        text = response.text
        try:
            data = response.json()
        except Exception:
            data = None
        return response.status_code, data, text
    except Exception as exc:
        return 0, None, repr(exc)


def flatten_values(value: Any) -> list[str]:
    result: list[str] = []
    if value is None:
        return result
    if isinstance(value, (str, int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        for item in value:
            result.extend(flatten_values(item))
        return result
    if isinstance(value, dict):
        for key in ("raw_values", "value", "name", "contributor_name", "list_name"):
            if key in value:
                result.extend(flatten_values(value[key]))
        return result
    return result


status, contributors, contributors_raw = get_json("/api/contributors/")
(OUT / "contributors_response.json").write_text(
    json.dumps(contributors if contributors is not None else {"raw": contributors_raw}, indent=2, ensure_ascii=False),
    encoding="utf-8",
)
contributor_name = ""
if isinstance(contributors, list):
    for item in contributors:
        if isinstance(item, list) and item and item[0] == CONTRIBUTOR_ID:
            contributor_name = str(item[1]) if len(item) > 1 else ""
            break

list_status, lists_data, lists_raw = get_json(
    "/api/contributor-lists-sorted/", {"contributors": CONTRIBUTOR_ID}
)
(OUT / "contributor_lists_response.json").write_text(
    json.dumps(lists_data if lists_data is not None else {"raw": lists_raw}, indent=2, ensure_ascii=False),
    encoding="utf-8",
)

features: list[dict[str, Any]] = []
page = 1
next_url = True
page_statuses: list[dict[str, Any]] = []
while next_url and page <= 100:
    facility_status, data, raw = get_json(
        "/api/facilities/",
        {
            "contributors": CONTRIBUTOR_ID,
            "page": page,
            "pageSize": 50,
            "sort_by": "NAME",
            "number_of_public_contributors": "true",
        },
    )
    page_statuses.append({"page": page, "status": facility_status})
    (OUT / f"facilities_page_{page:03d}.json").write_text(
        json.dumps(data if data is not None else {"raw": raw}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    if facility_status != 200 or not isinstance(data, dict):
        break
    page_features = data.get("features") or []
    if not isinstance(page_features, list):
        break
    features.extend(page_features)
    next_url = bool(data.get("next"))
    page += 1
    time.sleep(0.25)

rows: list[dict[str, Any]] = []
for index, feature in enumerate(features, start=1):
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or [None, None]
    os_id = properties.get("os_id") or feature.get("id") or ""
    detail_status, detail, detail_raw = get_json(f"/api/facilities/{os_id}") if os_id else (0, None, "")
    if os_id:
        (OUT / f"detail_{os_id}.json").write_text(
            json.dumps(detail if detail is not None else {"raw": detail_raw}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    detail_props = detail.get("properties", {}) if isinstance(detail, dict) else {}
    contributors_flat = sorted(set(flatten_values(detail_props.get("contributors"))))
    partner_fields_flat = sorted(set(flatten_values(detail_props.get("partner_fields"))))
    extended_flat = sorted(set(flatten_values(detail_props.get("extended_fields"))))
    combined = " | ".join(
        str(x) for x in [
            properties.get("name", ""), properties.get("address", ""),
            properties.get("country_name", ""), " ".join(partner_fields_flat),
            " ".join(extended_flat),
        ]
    ).lower()
    score = 0
    reasons: list[str] = []
    for keyword, weight in [
        ("winzen", 100), ("永生", 100), ("zhongshan", 60), ("中山", 60),
        ("vietnam", 25), ("bag", 20), ("luggage", 20), ("accessor", 15),
        ("garment", 10), ("apparel", 10), ("knit", 10), ("polo", 15),
    ]:
        if keyword in combined:
            score += weight
            reasons.append(keyword)
    rows.append({
        "row_number": index,
        "os_id": os_id,
        "name": properties.get("name", ""),
        "address": properties.get("address", ""),
        "country_code": properties.get("country_code", ""),
        "country_name": properties.get("country_name", ""),
        "longitude": coords[0] if len(coords) > 0 else None,
        "latitude": coords[1] if len(coords) > 1 else None,
        "has_approved_claim": properties.get("has_approved_claim", ""),
        "is_closed": properties.get("is_closed", ""),
        "public_contributor_count": properties.get("number_of_public_contributors", ""),
        "detail_http_status": detail_status,
        "contributors": " | ".join(contributors_flat),
        "partner_fields": " | ".join(partner_fields_flat),
        "extended_fields": " | ".join(extended_flat),
        "target_score": score,
        "target_reasons": " | ".join(reasons),
    })
    time.sleep(0.15)

fields = list(rows[0].keys()) if rows else [
    "row_number", "os_id", "name", "address", "country_code", "country_name",
    "longitude", "latitude", "has_approved_claim", "is_closed",
    "public_contributor_count", "detail_http_status", "contributors",
    "partner_fields", "extended_fields", "target_score", "target_reasons",
]
with (OUT / "fred_perry_tier1_facilities.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

candidates = sorted((row for row in rows if int(row.get("target_score") or 0) > 0), key=lambda r: (-int(r["target_score"]), r["name"]))
with (OUT / "target_factory_candidates.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(candidates)

manifest = {
    "captured_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    "base_url": BASE,
    "contributor_id": CONTRIBUTOR_ID,
    "contributor_name": contributor_name,
    "contributors_http_status": status,
    "lists_http_status": list_status,
    "lists_count": len(lists_data) if isinstance(lists_data, list) else 0,
    "facility_count": len(rows),
    "target_candidate_count": len(candidates),
    "page_statuses": page_statuses,
    "policy": "APPEND_ONLY_FAIL_CLOSED",
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

hash_lines: list[str] = []
for path in sorted(p for p in OUT.rglob("*") if p.is_file() and p.name != "SHA256SUMS.txt"):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    hash_lines.append(f"{digest}  {path.relative_to(OUT).as_posix()}")
(OUT / "SHA256SUMS.txt").write_text("\n".join(hash_lines) + "\n", encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False))
