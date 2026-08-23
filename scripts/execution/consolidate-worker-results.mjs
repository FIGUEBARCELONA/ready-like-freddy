import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readJson, sha256, writeJson } from "./common.mjs";
import { loadProgressLedger } from "./progress-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const inputRoot = resolve(args.input ?? "execution/downloaded-workers");
const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const progressPath = resolve(args.progress ?? "data/execution/product-progress.json");
const progressDeltasDir = resolve(
  args.progressDeltas ?? "data/execution/progress-deltas",
);
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

function identityKeyOf(candidate) {
  return `${candidate.productCode}|${candidate.colourCode}`;
}

function preferredUrlScore(candidate) {
  const url = new URL(candidate.productUrl);
  const pathDepth = url.pathname.split("/").filter(Boolean).length;
  return [
    candidate.imageReferences?.length ?? 0,
    candidate.sourceOccurrences ?? 1,
    Number(Boolean(candidate.displayName)),
    -pathDepth,
    -candidate.productUrl.length,
  ];
}

function compareScores(a, b) {
  const left = preferredUrlScore(a);
  const right = preferredUrlScore(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return a.productUrl.localeCompare(b.productUrl);
}

const files = await walk(inputRoot);
const summaryFiles = files.filter(path => basename(path) === "summary.json");
const recordFiles = files.filter(path => basename(path) === "records.ndjson");
const productLinkFiles = files.filter(path => basename(path) === "product-links.ndjson");
const workerSummaries = await Promise.all(summaryFiles.map(readJson));
const slots = new Set(workerSummaries.map(summary => summary.slot));
const expectedSlots = new Set(
  Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`),
);
const missingSlots = [...expectedSlots].filter(slot => !slots.has(slot));
if (missingSlots.length) throw new Error(`Missing worker summaries: ${missingSlots.join(", ")}`);
if (workerSummaries.length !== 50 || slots.size !== 50) {
  throw new Error(`Expected exactly 50 unique worker summaries; got ${workerSummaries.length}/${slots.size}`);
}
if (workerSummaries.some(summary => summary.queueSha256 !== queue.queueSha256)) {
  throw new Error("Worker summary queue hash mismatch");
}

const records = await readNdjson(recordFiles, (record, path) => {
  if (record.queueSha256 !== queue.queueSha256) {
    throw new Error(`Record queue hash mismatch in ${path}`);
  }
});
const productLinkCandidates = await readNdjson(productLinkFiles, (candidate, path) => {
  if (candidate.queueSha256 !== queue.queueSha256) {
    throw new Error(`Product-link queue hash mismatch in ${path}`);
  }
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

const uniqueProductUrlCandidates = [...productUrlGroups.entries()]
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

const identityGroups = new Map();
for (const candidate of uniqueProductUrlCandidates) {
  const key = identityKeyOf(candidate);
  const group = identityGroups.get(key) ?? [];
  group.push(candidate);
  identityGroups.set(key, group);
}

const productIdentityCandidates = [...identityGroups.entries()]
  .map(([identityKey, group]) => {
    const sorted = [...group].sort(compareScores);
    const preferred = sorted[0];
    const aliasUrls = sorted.map(candidate => candidate.productUrl);
    return {
      ...preferred,
      schemaVersion: 2,
      candidateKey: sha256(Buffer.from(identityKey)),
      identityKey,
      productUrl: preferred.productUrl,
      preferredProductUrl: preferred.productUrl,
      aliasUrls,
      aliasCount: aliasUrls.length,
      sourceOccurrences: group.reduce((sum, item) => sum + (item.sourceOccurrences ?? 1), 0),
      sourcePageUrls: [...new Set(group.flatMap(item => item.sourcePageUrls ?? [item.sourcePageUrl]))].sort(),
      sourceSlots: [...new Set(group.flatMap(item => item.sourceSlots ?? [item.slot]))].sort(),
      imageReferences: [...new Map(
        group.flatMap(item => item.imageReferences ?? []).map(image => [image.sourceUrl, image]),
      ).values()],
      uniquenessStatus: "CODE_COLOUR_IDENTITY_CANDIDATE_REQUIRES_GLOBAL_REVIEW",
    };
  })
  .sort((a, b) => a.identityKey.localeCompare(b.identityKey));

const progress = await loadProgressLedger({
  basePath: progressPath,
  deltasDir: progressDeltasDir,
});
const completedIdentityKeys = new Set(progress.completed.identityKeys);
const retryIdentityKeys = new Set(
  progress.retry.identities.map(item => item.identityKey).filter(Boolean),
);
const remainingIdentityCandidates = productIdentityCandidates.filter(
  candidate => !completedIdentityKeys.has(candidate.identityKey),
);
const prioritizedRemaining = [
  ...remainingIdentityCandidates.filter(candidate => retryIdentityKeys.has(candidate.identityKey)),
  ...remainingIdentityCandidates.filter(candidate => !retryIdentityKeys.has(candidate.identityKey)),
];

const productPerWorkerLimit = Number(queue.plan.productPilotPerWorkerLimit ?? 1);
if (!Number.isInteger(productPerWorkerLimit) || productPerWorkerLimit < 1 || productPerWorkerLimit > 100) {
  throw new Error(`Invalid productPilotPerWorkerLimit: ${productPerWorkerLimit}`);
}
const batchCapacity = 50 * productPerWorkerLimit;
const selectedIdentityCandidates = prioritizedRemaining.slice(0, batchCapacity);
const productAssignments = Array.from({ length: 50 }, (_, index) => ({
  slot: `F${String(index + 1).padStart(2, "0")}`,
  index,
  products: selectedIdentityCandidates.filter((_, productIndex) => productIndex % 50 === index),
}));
const expectedProductCaptureCount = selectedIdentityCandidates.length;
const productFrontier = {
  schemaVersion: 4,
  frontierId: `${queue.queueId}-PRODUCTS`,
  createdAt: new Date().toISOString(),
  sourceQueueId: queue.queueId,
  sourceQueueSha256: queue.queueSha256,
  workerCount: 50,
  uniqueProductUrlCount: uniqueProductUrlCandidates.length,
  uniqueProductIdentityCount: productIdentityCandidates.length,
  aliasProductUrlCount: uniqueProductUrlCandidates.length - productIdentityCandidates.length,
  previouslyCompletedIdentityCount: completedIdentityKeys.size,
  remainingIdentityCountBeforeSelection: remainingIdentityCandidates.length,
  retryIdentityCount: selectedIdentityCandidates.filter(candidate => retryIdentityKeys.has(candidate.identityKey)).length,
  productPerWorkerLimit,
  batchCapacity,
  selectedIdentityCount: selectedIdentityCandidates.length,
  expectedProductCaptureCount,
  selectedIdentitySha256: sha256(Buffer.from(selectedIdentityCandidates.map(item => item.identityKey).join("\n"))),
  progressSha256: progress.ledgerSha256,
  progressDeltaCount: progress.deltaCount,
  assignments: productAssignments,
};
productFrontier.frontierSha256 = sha256(Buffer.from(JSON.stringify(productFrontier)));

const totals = {
  attemptedUrlCount: records.length,
  successfulFetchCount: records.filter(record => record.fetchOk).length,
  failedFetchCount: records.filter(record => !record.fetchOk).length,
  directSourceCount: records.filter(record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP").length,
  transformedReaderSourceCount: records.filter(
    record => record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE",
  ).length,
  blockedOriginCount: records.filter(record => [403, 429, 503].includes(record.originResponse?.httpStatus)).length,
  structuredProductEvidenceCount: records.filter(record => record.structuredProductEvidence).length,
  sourcePageCount: canonicalGroups.size,
  duplicateSourcePageCount: [...canonicalGroups.values()].filter(group => group.length > 1).length,
  imageReferenceCount: records.reduce((sum, record) => sum + (record.imageReferences?.length ?? 0), 0),
  productMediaReferenceCount: records.reduce((sum, record) => sum + (record.productMediaReferenceCount ?? 0), 0),
  productLinkCandidateCount: productLinkCandidates.length,
  uniqueProductUrlCount: uniqueProductUrlCandidates.length,
  duplicateProductUrlCount: productLinkCandidates.length - uniqueProductUrlCandidates.length,
  uniqueProductIdentityCount: productIdentityCandidates.length,
  aliasProductUrlCount: uniqueProductUrlCandidates.length - productIdentityCandidates.length,
  previouslyCompletedIdentityCount: completedIdentityKeys.size,
  remainingIdentityCountBeforeSelection: remainingIdentityCandidates.length,
  selectedIdentityCount: selectedIdentityCandidates.length,
  retryIdentityCount: productFrontier.retryIdentityCount,
  expectedProductCaptureCount,
  productCandidateImageReferenceCount: productIdentityCandidates.reduce(
    (sum, candidate) => sum + (candidate.imageReferences?.length ?? 0),
    0,
  ),
};
const minimumBatch = Math.min(50, remainingIdentityCandidates.length);
const qualityGatePassed =
  workerSummaries.length === 50 &&
  totals.successfulFetchCount > 0 &&
  totals.uniqueProductIdentityCount >= 50 &&
  expectedProductCaptureCount >= minimumBatch;
const consolidated = {
  schemaVersion: 6,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  workerCount: 50,
  orchestrationStatus: "FIFTY_OF_FIFTY_WORKERS_CONSOLIDATED",
  transportStatus: totals.successfulFetchCount > 0 ? "USABLE_SOURCE_CAPTURED" : "NO_USABLE_SOURCE_CAPTURED",
  extractionStatus: totals.uniqueProductIdentityCount > 0 ? "PRODUCT_IDENTITY_FRONTIER_READY" : "NO_PRODUCT_IDENTITIES_EXTRACTED",
  qualityGatePassed,
  workerSummaries: workerSummaries.sort((a, b) => a.slot.localeCompare(b.slot)),
  totals,
  productFrontierSha256: productFrontier.frontierSha256,
  productStatus: "CODE_COLOUR_IDENTITY_CANDIDATES_NOT_GLOBAL_CANONICAL_PRODUCTS",
  imageStatus: "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
  progressStatus: "APPEND_ONLY_LEDGER_APPLIED",
  progressLedgerSha256: progress.ledgerSha256,
  progressDeltaCount: progress.deltaCount,
  completedAt: new Date().toISOString(),
};
consolidated.manifestSha256 = sha256(Buffer.from(JSON.stringify(consolidated)));

await writeJson(`${outDir}/manifest.json`, consolidated);
await writeFile(
  `${outDir}/records.ndjson`,
  records.length ? `${records.map(record => JSON.stringify(record)).join("\n")}\n` : "",
  "utf8",
);
await writeFile(
  `${outDir}/product-candidates.ndjson`,
  uniqueProductUrlCandidates.length
    ? `${uniqueProductUrlCandidates.map(record => JSON.stringify(record)).join("\n")}\n`
    : "",
  "utf8",
);
await writeFile(
  `${outDir}/product-identities.ndjson`,
  productIdentityCandidates.length
    ? `${productIdentityCandidates.map(record => JSON.stringify(record)).join("\n")}\n`
    : "",
  "utf8",
);
await writeFile(
  `${outDir}/product-link-candidates.ndjson`,
  productLinkCandidates.length
    ? `${productLinkCandidates.map(record => JSON.stringify(record)).join("\n")}\n`
    : "",
  "utf8",
);
await writeJson(`${outDir}/product-frontier.json`, productFrontier);
await writeJson(
  `${outDir}/canonical-duplicate-groups.json`,
  [...canonicalGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([canonicalUrl, group]) => ({ canonicalUrl, records: group })),
);
await writeJson(
  `${outDir}/duplicate-product-urls.json`,
  [...productUrlGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([productUrl, group]) => ({ productUrl, occurrences: group })),
);
await writeJson(
  `${outDir}/product-identity-aliases.json`,
  productIdentityCandidates
    .filter(candidate => candidate.aliasCount > 1)
    .map(candidate => ({
      identityKey: candidate.identityKey,
      productCode: candidate.productCode,
      colourCode: candidate.colourCode,
      preferredProductUrl: candidate.preferredProductUrl,
      aliasUrls: candidate.aliasUrls,
    })),
);
console.log(JSON.stringify(consolidated, null, 2));
