import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const inputRoot = resolve(args.input ?? "execution/downloaded-workers");
const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const outDir = resolve(args.out ?? "execution/consolidated");
const queue = await readJson(queuePath);
await mkdir(outDir, { recursive: true });

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(inputRoot);
const summaryFiles = files.filter(path => basename(path) === "summary.json");
const ndjsonFiles = files.filter(path => basename(path) === "records.ndjson");
const workerSummaries = await Promise.all(summaryFiles.map(readJson));
const slots = new Set(workerSummaries.map(summary => summary.slot));
const expectedSlots = new Set(
  Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`),
);
const missingSlots = [...expectedSlots].filter(slot => !slots.has(slot));
if (missingSlots.length) {
  throw new Error(`Missing worker summaries: ${missingSlots.join(", ")}`);
}
if (workerSummaries.length !== 50 || slots.size !== 50) {
  throw new Error(
    `Expected exactly 50 unique worker summaries, got ${workerSummaries.length} files and ${slots.size} unique slots`,
  );
}
if (workerSummaries.some(summary => summary.queueSha256 !== queue.queueSha256)) {
  throw new Error("Worker summary queue hash mismatch");
}

const records = [];
for (const path of ndjsonFiles) {
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.queueSha256 !== queue.queueSha256) {
      throw new Error(`Record queue hash mismatch in ${path}`);
    }
    records.push(record);
  }
}

const canonicalGroups = new Map();
for (const record of records.filter(record => record.fetchOk)) {
  const key = record.canonicalUrl ?? record.finalUrl ?? record.requestedUrl;
  const group = canonicalGroups.get(key) ?? [];
  group.push(record);
  canonicalGroups.set(key, group);
}
const candidateRecords = records.filter(record => {
  if (!record.fetchOk || !record.finalUrl) return false;
  const path = new URL(record.finalUrl).pathname;
  return Boolean(
    record.structuredProductEvidence ||
      record.productCode ||
      /\/(?:product|products|shop)\//i.test(path) ||
      /\.(?:html?)$/i.test(path),
  );
});
const successfulFetchCount = records.filter(record => record.fetchOk).length;
const directSourceCount = records.filter(
  record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk,
).length;
const transformedReaderSourceCount = records.filter(
  record =>
    record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" && record.fetchOk,
).length;
const blockedOriginCount = records.filter(
  record => record.originResponse?.httpStatus === 403,
).length;

const consolidated = {
  schemaVersion: 2,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  workerCount: 50,
  workerSummaries: workerSummaries.sort((a, b) => a.slot.localeCompare(b.slot)),
  totals: {
    attemptedUrlCount: records.length,
    successfulFetchCount,
    failedFetchCount: records.filter(record => !record.fetchOk).length,
    directSourceCount,
    transformedReaderSourceCount,
    blockedOriginCount,
    structuredProductEvidenceCount: records.filter(record => record.structuredProductEvidence)
      .length,
    candidateRecordCount: candidateRecords.length,
    canonicalUrlGroupCount: canonicalGroups.size,
    duplicateCanonicalGroupCount: [...canonicalGroups.values()].filter(group => group.length > 1)
      .length,
    imageReferenceCount: records.reduce(
      (sum, record) => sum + (record.imageReferences?.length ?? 0),
      0,
    ),
  },
  orchestrationStatus: "FIFTY_OF_FIFTY_WORKERS_CONSOLIDATED",
  transportStatus:
    successfulFetchCount > 0
      ? "USABLE_SOURCE_CAPTURED"
      : "BLOCKED_NO_USABLE_SOURCE_CAPTURED",
  qualityGatePassed: successfulFetchCount > 0,
  productStatus: "CANDIDATES_ONLY_NOT_CANONICAL_UNIQUE_PRODUCTS",
  imageStatus: "SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
  completedAt: new Date().toISOString(),
};
consolidated.manifestSha256 = sha256(Buffer.from(JSON.stringify(consolidated)));
await writeJson(`${outDir}/manifest.json`, consolidated);
await writeFile(
  `${outDir}/records.ndjson`,
  `${records.map(record => JSON.stringify(record)).join("\n")}\n`,
  "utf8",
);
await writeFile(
  `${outDir}/product-candidates.ndjson`,
  `${candidateRecords.map(record => JSON.stringify(record)).join("\n")}\n`,
  "utf8",
);
await writeJson(
  `${outDir}/canonical-duplicate-groups.json`,
  [...canonicalGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([canonicalUrl, group]) => ({ canonicalUrl, records: group })),
);
console.log(JSON.stringify(consolidated, null, 2));
