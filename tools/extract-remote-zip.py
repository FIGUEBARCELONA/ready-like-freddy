#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

TOOLS_DIR = Path(__file__).resolve().parent
INVENTORY_SCRIPT = TOOLS_DIR / "inventory-remote-zip.py"
spec = importlib.util.spec_from_file_location("rlf_inventory_remote_zip", INVENTORY_SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {INVENTORY_SCRIPT}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
HTTPRangeReader = module.HTTPRangeReader

MAX_MEMBER_SIZE = 64 * 1024 * 1024
OUTER_PREFIX = "GENERAL + KB/"
DUPLICATE_PREFIX = "Arxiu 2/"
WORKSTREAM_BASENAME = "RLF_WORKSTREAM_CONTROL_FULL_BACKUP_20260822.zip"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repair_mojibake(value: str) -> str:
    candidates = [value]
    for encoding in ("cp437", "latin1"):
        try:
            candidate = value.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        candidates.append(candidate)

    def score(text: str) -> tuple[int, int]:
        artifacts = sum(text.count(token) for token in ("ΓÇ", "╠", "Ã", "Â", "�"))
        controls = sum(1 for char in text if unicodedata.category(char) == "Cc")
        return artifacts + controls, len(text)

    return min(candidates, key=score)


def safe_relative_path(name: str) -> Path:
    repaired = repair_mojibake(name.replace("\\", "/"))
    pure = PurePosixPath(repaired)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise ValueError(f"Unsafe ZIP member path: {name!r}")
    return Path(*pure.parts)


def safe_extract_archive(source: Path, destination: Path) -> dict[str, object]:
    destination.mkdir(parents=True, exist_ok=True)
    extracted: list[dict[str, object]] = []
    with zipfile.ZipFile(source) as archive:
        bad_member = archive.testzip()
        if bad_member is not None:
            raise RuntimeError(f"CRC failure in {source.name}: {bad_member}")
        for info in archive.infolist():
            if info.is_dir():
                continue
            relative = safe_relative_path(info.filename)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            extracted.append({
                "member": info.filename,
                "path": str(target),
                "bytes": target.stat().st_size,
                "sha256": sha256_file(target),
            })
    return {"archive": str(source), "entries": extracted, "count": len(extracted)}


def parse_expected_hash(path: Path) -> str | None:
    if not path.is_file():
        return None
    match = re.search(r"\b([0-9a-fA-F]{64})\b", path.read_text(encoding="utf-8", errors="replace"))
    return match.group(1).lower() if match else None


def verify_parts_manifest(manifest: Path, directory: Path) -> dict[str, object]:
    if not manifest.is_file():
        return {"manifest": str(manifest), "present": False, "verified": False, "entries": []}
    records: list[dict[str, object]] = []
    all_ok = True
    for raw_line in manifest.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = re.match(r"^([0-9a-fA-F]{64})\s+[* ]?(.+)$", line)
        if not match:
            records.append({"line": raw_line, "parsed": False})
            all_ok = False
            continue
        expected, raw_name = match.groups()
        name = Path(raw_name).name
        path = directory / name
        actual = sha256_file(path) if path.is_file() else None
        ok = actual == expected.lower()
        all_ok = all_ok and ok
        records.append({
            "name": name,
            "expected": expected.lower(),
            "actual": actual,
            "present": path.is_file(),
            "ok": ok,
        })
    return {"manifest": str(manifest), "present": True, "verified": all_ok, "entries": records}


def main() -> int:
    diagnostics = Path("diagnostics")
    url_path = diagnostics / "download-url.txt"
    if not url_path.is_file():
        raise SystemExit("diagnostics/download-url.txt was not created")
    url = url_path.read_text(encoding="utf-8").strip()
    if not url:
        raise SystemExit("Captured download URL is empty")

    recovered_root = Path("recovered-small")
    reconstructed_root = Path("reconstructed")
    shutil.rmtree(recovered_root, ignore_errors=True)
    shutil.rmtree(reconstructed_root, ignore_errors=True)
    recovered_root.mkdir(parents=True, exist_ok=True)
    reconstructed_root.mkdir(parents=True, exist_ok=True)

    reader = HTTPRangeReader(url)
    extracted: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []

    with zipfile.ZipFile(reader) as outer:
        for info in outer.infolist():
            original = info.filename
            if info.is_dir() or not original.startswith(OUTER_PREFIX):
                continue
            relative_original = original[len(OUTER_PREFIX):]
            repaired_relative = repair_mojibake(relative_original)
            if repaired_relative.startswith(DUPLICATE_PREFIX):
                skipped.append({"name": original, "reason": "duplicate-subtree"})
                continue
            if repaired_relative == ".DS_Store" or repaired_relative.startswith("._"):
                skipped.append({"name": original, "reason": "macos-metadata"})
                continue
            if info.file_size > MAX_MEMBER_SIZE:
                skipped.append({"name": original, "reason": "over-selective-limit", "bytes": info.file_size})
                continue

            relative = safe_relative_path(repaired_relative)
            target = recovered_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with outer.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            actual_size = target.stat().st_size
            if actual_size != info.file_size:
                raise RuntimeError(f"Size mismatch for {original}: {actual_size} != {info.file_size}")
            extracted.append({
                "outer_member": original,
                "path": str(target),
                "bytes": actual_size,
                "compressed_bytes": info.compress_size,
                "crc32": f"{info.CRC:08x}",
                "sha256": sha256_file(target),
            })

    parts = [recovered_root / f"{WORKSTREAM_BASENAME}.part{index:02d}" for index in range(10)]
    missing_parts = [str(path) for path in parts if not path.is_file()]
    if missing_parts:
        raise RuntimeError(f"Missing canonical workstream backup parts: {missing_parts}")

    parts_verification = verify_parts_manifest(
        recovered_root / f"{WORKSTREAM_BASENAME}.PARTS_SHA256SUMS",
        recovered_root,
    )
    if not parts_verification["verified"]:
        raise RuntimeError("The canonical split-part SHA-256 manifest did not verify")

    reconstructed_zip = reconstructed_root / WORKSTREAM_BASENAME
    with reconstructed_zip.open("wb") as output:
        for part in parts:
            with part.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)

    reconstructed_sha256 = sha256_file(reconstructed_zip)
    expected_whole = parse_expected_hash(recovered_root / f"{WORKSTREAM_BASENAME}.SHA256")
    if expected_whole is None:
        raise RuntimeError("Whole-archive SHA-256 was not found")
    if reconstructed_sha256 != expected_whole:
        raise RuntimeError(
            f"Reconstructed workstream ZIP SHA-256 mismatch: {reconstructed_sha256} != {expected_whole}"
        )

    workstream_extraction = safe_extract_archive(
        reconstructed_zip,
        reconstructed_root / "RLF_WORKSTREAM_CONTROL_FULL_BACKUP_20260822",
    )

    nested_extractions: list[dict[str, object]] = []
    for nested_name in ("Arxiu.zip", "Arxiu 3.zip"):
        nested = recovered_root / nested_name
        if nested.is_file():
            nested_extractions.append(
                safe_extract_archive(nested, reconstructed_root / nested.stem)
            )

    file_manifest = []
    for base in (recovered_root, reconstructed_root):
        for path in sorted(p for p in base.rglob("*") if p.is_file()):
            file_manifest.append({
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            })

    summary = {
        "outer_remote_size_bytes": reader.size,
        "http_range_requests": reader.requests,
        "http_bytes_fetched": reader.bytes_fetched,
        "selectively_extracted_count": len(extracted),
        "selectively_extracted": extracted,
        "skipped_count": len(skipped),
        "skipped": skipped,
        "parts_verification": parts_verification,
        "reconstructed_zip": {
            "path": str(reconstructed_zip),
            "bytes": reconstructed_zip.stat().st_size,
            "expected_sha256": expected_whole,
            "actual_sha256": reconstructed_sha256,
            "verified": True,
        },
        "workstream_extraction": workstream_extraction,
        "nested_extractions": nested_extractions,
        "file_manifest": file_manifest,
    }
    (diagnostics / "selective-recovery-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "outer_remote_size_bytes": reader.size,
        "http_range_requests": reader.requests,
        "http_bytes_fetched": reader.bytes_fetched,
        "selectively_extracted_count": len(extracted),
        "reconstructed_zip_sha256": reconstructed_sha256,
        "workstream_entries": workstream_extraction["count"],
        "nested_archives": [item["archive"] for item in nested_extractions],
        "retained_files": len(file_manifest),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SELECTIVE_REMOTE_RECOVERY_FAILED: {exc}", file=sys.stderr)
        raise
