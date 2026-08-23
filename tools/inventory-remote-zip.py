#!/usr/bin/env python3
from __future__ import annotations

import collections
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

BLOCK_SIZE = 2 * 1024 * 1024
MAX_BLOCKS = 64


class HTTPRangeReader(io.RawIOBase):
    def __init__(self, url: str, block_size: int = BLOCK_SIZE) -> None:
        self.url = url.strip()
        self.block_size = block_size
        self.position = 0
        self.size = self._discover_size()
        self.cache: collections.OrderedDict[int, bytes] = collections.OrderedDict()
        self.requests = 0
        self.bytes_fetched = 0

    def _request(self, start: int, end: int) -> bytes:
        request = urllib.request.Request(
            self.url,
            headers={
                "Range": f"bytes={start}-{end}",
                "Accept-Encoding": "identity",
                "User-Agent": "RLF-Remote-ZIP-Inventory/1.0",
            },
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            status = getattr(response, "status", response.getcode())
            body = response.read()
            if status != 206:
                raise RuntimeError(
                    f"Remote server did not honor Range request {start}-{end}: HTTP {status}, {len(body)} bytes"
                )
            self.requests += 1
            self.bytes_fetched += len(body)
            return body

    def _discover_size(self) -> int:
        request = urllib.request.Request(
            self.url,
            headers={
                "Range": "bytes=0-0",
                "Accept-Encoding": "identity",
                "User-Agent": "RLF-Remote-ZIP-Inventory/1.0",
            },
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            status = getattr(response, "status", response.getcode())
            content_range = response.headers.get("Content-Range", "")
            if status != 206:
                raise RuntimeError(f"Remote server does not support byte ranges: HTTP {status}")
            match = re.fullmatch(r"bytes\s+\d+-\d+/(\d+)", content_range)
            if not match:
                raise RuntimeError(f"Missing or invalid Content-Range header: {content_range!r}")
            return int(match.group(1))

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        if whence == os.SEEK_SET:
            new_position = offset
        elif whence == os.SEEK_CUR:
            new_position = self.position + offset
        elif whence == os.SEEK_END:
            new_position = self.size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if new_position < 0:
            raise ValueError("Negative seek position")
        self.position = new_position
        return self.position

    def _block(self, index: int) -> bytes:
        if index in self.cache:
            data = self.cache.pop(index)
            self.cache[index] = data
            return data
        start = index * self.block_size
        end = min(self.size - 1, start + self.block_size - 1)
        data = self._request(start, end)
        self.cache[index] = data
        while len(self.cache) > MAX_BLOCKS:
            self.cache.popitem(last=False)
        return data

    def read(self, size: int = -1) -> bytes:
        if self.position >= self.size:
            return b""
        if size is None or size < 0:
            end_position = self.size
        else:
            end_position = min(self.size, self.position + size)
        chunks: list[bytes] = []
        while self.position < end_position:
            block_index = self.position // self.block_size
            offset = self.position % self.block_size
            block = self._block(block_index)
            take = min(end_position - self.position, len(block) - offset)
            if take <= 0:
                break
            chunks.append(block[offset : offset + take])
            self.position += take
        return b"".join(chunks)

    def readinto(self, buffer: bytearray | memoryview) -> int:
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)


def classify_candidate(name: str, size: int) -> list[str]:
    lower = name.lower()
    labels: list[str] = []
    if any(token in lower for token in ("dashboard", "worker", "parallel", "queue", "backend", "executor", "orchestrat")):
        labels.append("execution-dashboard")
    if any(token in lower for token in ("readme", "dossier", "master", "checklist", "roadmap", "status", "manifest", "provenance")):
        labels.append("project-control")
    if PurePosixPath(lower).suffix in {
        ".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".sql", ".md", ".txt", ".csv", ".html", ".css", ".sh", ".ps1"
    }:
        labels.append("source-or-text")
    if any(token in lower for token in ("kb", "catalog", "product", "supplier", "proveidor", "etiquet", "label")):
        labels.append("rlf-data")
    if size <= 64 * 1024 * 1024 and labels:
        labels.append("selective-extraction-eligible")
    return labels


def main() -> int:
    root = Path("diagnostics")
    url_path = root / "download-url.txt"
    if not url_path.is_file():
        raise SystemExit("diagnostics/download-url.txt was not created")
    url = url_path.read_text(encoding="utf-8").strip()
    if not url:
        raise SystemExit("Captured download URL is empty")

    reader = HTTPRangeReader(url)
    inventory_path = root / "remote-zip-inventory.tsv"
    candidates_path = root / "remote-zip-candidates.tsv"
    summary_path = root / "remote-zip-summary.json"

    top_levels: collections.Counter[str] = collections.Counter()
    extensions: collections.Counter[str] = collections.Counter()
    candidate_rows: list[tuple[int, str, int, int, str]] = []
    total_uncompressed = 0
    total_compressed = 0
    entry_count = 0

    with zipfile.ZipFile(reader) as archive, inventory_path.open("w", encoding="utf-8", newline="") as inventory:
        inventory.write("index\tname\tis_dir\tcompression\tcompressed_size\tuncompressed_size\tcrc32\tflags\n")
        infos = archive.infolist()
        entry_count = len(infos)
        for index, info in enumerate(infos):
            name = info.filename
            total_uncompressed += info.file_size
            total_compressed += info.compress_size
            clean = name.strip("/")
            if clean:
                top_levels[clean.split("/", 1)[0]] += 1
            suffix = PurePosixPath(clean).suffix.lower() if clean else ""
            extensions[suffix or "<none>"] += 1
            inventory.write(
                f"{index}\t{name}\t{int(info.is_dir())}\t{info.compress_type}\t{info.compress_size}\t"
                f"{info.file_size}\t{info.CRC:08x}\t{info.flag_bits}\n"
            )
            labels = classify_candidate(name, info.file_size)
            if labels and not info.is_dir():
                candidate_rows.append((index, name, info.compress_size, info.file_size, ",".join(labels)))

    with candidates_path.open("w", encoding="utf-8", newline="") as candidates:
        candidates.write("index\tname\tcompressed_size\tuncompressed_size\tlabels\n")
        for row in sorted(candidate_rows, key=lambda item: ("selective-extraction-eligible" not in item[4], item[3], item[1].lower())):
            candidates.write("\t".join(map(str, row)) + "\n")

    summary = {
        "remote_size_bytes": reader.size,
        "zip_entries": entry_count,
        "total_compressed_bytes_from_central_directory": total_compressed,
        "total_uncompressed_bytes": total_uncompressed,
        "http_range_requests": reader.requests,
        "http_bytes_fetched": reader.bytes_fetched,
        "candidate_count": len(candidate_rows),
        "top_level_entries": top_levels.most_common(),
        "extensions": extensions.most_common(),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, zipfile.BadZipFile, RuntimeError) as exc:
        print(f"REMOTE_ZIP_INVENTORY_FAILED: {exc}", file=sys.stderr)
        raise
