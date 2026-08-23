import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const dossier = "/home/ubuntu/rlf_review/RLF_EXECUTION_DOSSIER_20260821";
const books = [
  "data/RLF_GLOBAL_CORPUS_INITIAL_VARIANT_REGISTER_20260822.csv",
  "data/RLF_GLOBAL_CORPUS_INITIAL_GAP_REGISTER_20260822.csv",
  "data/RLF_OFFICIAL_SOURCE_REGISTRY_20260822.md",
  "data/RLF_EXACT_VARIANT_RAW_COLOUR_SCOPE_20260822.jsonl",
  "data/RLF_GLOBAL_CORPUS_EXACT_VARIANT_COLOUR_NORMALIZATION_20260822.jsonl",
  "data/RLF_GLOBAL_CORPUS_CONSOLIDATED_NORMALIZATION_METRICS_20260822.txt",
  "data_contracts/RLF_HISTORICAL_PRODUCT_FACTORY_CORPUS_SCHEMA_v1_20260822.md",
  "data_contracts/RLF_ORIGINAL_FRED_PERRY_ONLY_OPERATING_POLICY_v1_20260822.md",
  "data_contracts/RLF_GLOBAL_KB_EU_COMMERCIAL_SCOPE_POLICY_v1_20260822.md",
];

const entries = await Promise.all(books.map(async relativePath => {
  const absolutePath = `${dossier}/${relativePath}`;
  const bytes = await readFile(absolutePath);
  const fileStat = await stat(absolutePath);
  return {
    relativePath,
    sourcePath: absolutePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: fileStat.size,
    sourceMode: "READ_ONLY",
  };
}));

const outputPath = "/home/ubuntu/rlf-workstream-control/data/canonical-books-manifest.json";
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  manifestFormat: "RLF-CANONICAL-BOOKS/1.0",
  generatedAtUtc: new Date().toISOString(),
  sourceRoot: dossier,
  writePolicy: "NO_WRITES_TO_CANONICAL_SOURCES",
  books: entries,
}, null, 2)}\n`);
console.log(JSON.stringify({ books: entries.length, outputPath }));
