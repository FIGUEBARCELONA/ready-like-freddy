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

async function readNdjson(paths, verifier) {
  const values = [];
  for (const path of paths) {
    const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) continue;
      const value = JSON.parse(line);
      verifier(value, path);
      values.push(value);
    }
  }
  return values;
}

const files = await walk(inputRoot);
const summaryFiles = files.filter(path => basename(path) === "summary.json");
const recordFiles = files.filter(path => basename(path) === "records.ndjson");
const productLinkFiles = files.filter(path => basename(path) === "product-links.ndjson");
const workerSummaries = await Promise.all(summaryFiles.map(readJson));
const slots = new Set(workerSummaries.map(summary => summary.slot));
const expectedSlots = new Set(Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`));
const missingSlots = [...expectedSlots].filter(slot => !slots.has(slot));
if (missingSlots.length) throw new Error(`Missing worker summaries: ${missingSlots.join(", ")}`);
if (workerSummaries.length !== 50 || slots.size !== 50) {
  throw new Error(`Expected exactly 50 unique worker summaries; got ${workerSummaries.length}/${slots.size}`);
}
if (workerSummaries.some(summary => summary.queueSha256 !== queue.queueSha256)) {
  throw new Error("Worker summary queue hash mismatch");
}

const records = await readNdjson(recordFiles, (record, path) => {
  if (record.queueSha256 !== queue.queueSha256) throw new Error(`Record queue hash mismatch in ${path}`);
});
const productLinkCandidates = await readNdjson(productLinkFiles, (candidate, path) => {
  if (candidate.queueSha256 !== queue.queueSha256) throw new Error(`Product-link queue hash mismatch in ${path}`);
  if (!candidate.productUrl || !candidate.productCode || !candidate.colourCode) {
    throw new Error(`Incomplete product-link candidate in ${path}`);
  }
});

const canonicalGroups = new Map();
for (const record of records.filter(record => record.fetchOk)) {
  const key = record.canonicalUrl ?? record.finalUrl ?? record.requestedUrl;
  const group = canonicalGroups.get(key) ?? [];
  group.push(record);
  canonicalGroups.set(key, group);
}
const productUrlGroups = new Map();
for (const candidate of productLinkCandidates) {
  const group = productUrlGroups.get(candidate.productUrl) ?? [];
  group.push(candidate);
  productUrlGroups.set(candidate.productUrl, group);
}
const uniqueProductCandidates = [...productUrlGroups.entries()]
  .map(([productUrl, group]) => {
    const preferred = [...group].sort((a, b) => {
      const imageDelta = (b.imageReferences?.length ?? 0) - (a.imageReferences?.length ?? 0);
      if (imageDelta) return imageDelta;
      return Number(Boolean(b.displayName)) - Number(Boolean(a.displayName));
    })[0];
    return {
      ...preferred,
      productUrl,
      sourceOccurrences: group.length,
      sourcePageUrls: [...new Set(group.map(item => item.sourcePageUrl))].sort(),
      sourceSlots: [...new Set(group.map(item => item.slot))].sort(),
    };
  })
  .sort((a, b) => a.productUrl.localeCompare(b.productUrl));

const productAssignments = Array.from({ length: 50 }, (_, index) => ({
  slot: `F${String(index + 1).padStart(2, "0")}`,
  index,
  products: uniqueProductCandidates.filter((_, productIndex) => productIndex % 50 === index),
}));
const productPerWorkerLimit = Number(queue.plan.productPilotPerWorkerLimit ?? 1);
if (!Number.isInteger(productPerWorkerLimit) || productPerWorkerLimit < 1 || productPerWorkerLimit > 100) {
  throw new Error(`Invalid productPilotPerWorkerLimit: ${productPerWorkerLimit}`);
}
const expectedProductCaptureCount = productAssignments.reduce(
  (sum, assignment) => sum + Math.min(productPerWorkerLimit, assignment.products.length),
  0,
);
const productFrontier = {
  schemaVersion: 2,
  frontierId: `${queue.queueId}-PRODUCTS`,
  createdAt: new Date().toISOString(),
  sourceQueueId: queue.queueId,
  sourceQueueSha256: queue.queueSha256,
  workerCount: 50,
  uniqueProductUrlCount: uniqueProductCandidates.length,
  productPerWorkerLimit,
  expectedProductCaptureCount,
  assignments: productAssignments,
};
productFrontier.frontierSha256 = sha256(Buffer.from(JSON.stringify(productFrontier)));

const totals = {
  attemptedUrlCount: records.length,
  successfulFetchCount: records.filter(record => record.fetchOk).length,
  failedFetchCount: records.filter(record => !record.fetchOk).length,
  directSourceCount: records.filter(record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP").length,
  transformedReaderSourceCount: records.filter(record => record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE").length,
  blockedOriginCount: records.filter(record => [403, 429, 503].includes(record.originResponse?.httpStatus)).length,
  structuredProductEvidenceCount: records.filter(record => record.structuredProductEvidence).length,
  sourcePageCount: canonicalGroups.size,
  duplicateSourcePageCount: [...canonicalGroups.values()].filter(group => group.length > 1).length,
  imageReferenceCount: records.reduce((sum, record) => sum + (record.imageReferences?.length ?? 0), 0),
  productMediaReferenceCount: records.reduce((sum, record) => sum + (record.productMediaReferenceCount ?? 0), 0),
  productLinkCandidateCount: productLinkCandidates.length,
  uniqueProductUrlCount: uniqueProductCandidates.length,
  duplicateProductUrlCount: productLinkCandidates.length - uniqueProductCandidates.length,
  productCandidateImageReferenceCount: uniqueProductCandidates.reduce((sum, candidate) => sum + (candidate.imageReferences?.length ?? 0), 0),
  expectedProductCaptureCount,
};
const qualityGatePassed = workerSummaries.length === 50 && totals.successfulFetchCount > 0 && totals.uniqueProductUrlCount >= 50 && expectedProductCaptureCount >= 50;
const consolidated = {
  schemaVersion: 4,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  workerCount: 50,
  orchestrationStatus: "FIFTY_OF_FIFTY_WORKERS_CONSOLIDATED",
  transportStatus: totals.successfulFetchCount > 0 ? "USABLE_SOURCE_CAPTURED" : "NO_USABLE_SOURCE_CAPTURED",
  extractionStatus: totals.uniqueProductUrlCount > 0 ? "PRODUCT_URL_FRONTIER_READY" : "NO_PRODUCT_URLS_EXTRACTED",
  qualityGatePassed,
  workerSummaries: workerSummaries.sort((a, b) => a.slot.localeCompare(b.slot)),
  totals,
  productFrontierSha256: productFrontier.frontierSha256,
  productStatus: "PRODUCT_URL_CANDIDATES_NOT_CANONICAL_UNIQUE_PRODUCTS",
  imageStatus: "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
  completedAt: new Date().toISOString(),
};
consolidated.manifestSha256 = sha256(Buffer.from(JSON.stringify(consolidated)));

await writeJson(`${outDir}/manifest.json`, consolidated);
await writeFile(`${outDir}/records.ndjson`, records.length ? `${records.map(record => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
await writeFile(`${outDir}/product-candidates.ndjson`, uniqueProductCandidates.length ? `${uniqueProductCandidates.map(record => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
await writeFile(`${outDir}/product-link-candidates.ndjson`, productLinkCandidates.length ? `${productLinkCandidates.map(record => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
await writeJson(`${outDir}/product-frontier.json`, productFrontier);
await writeJson(`${outDir}/canonical-duplicate-groups.json`, [...canonicalGroups.entries()].filter(([, group]) => group.length > 1).map(([canonicalUrl, group]) => ({ canonicalUrl, records: group })));
await writeJson(`${outDir}/duplicate-product-urls.json`, [...productUrlGroups.entries()].filter(([, group]) => group.length > 1).map(([productUrl, group]) => ({ productUrl, occurrences: group })));
console.log(JSON.stringify(consolidated, null, 2));
