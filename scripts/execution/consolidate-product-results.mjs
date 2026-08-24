import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readJson, sha256, writeJson } from "./common.mjs";
import { isOfficialProductMedia } from "./product-extraction.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const inputRoot = resolve(
  args.input ?? "execution/downloaded-product-workers",
);
const frontierPath = resolve(
  args.frontier ?? "execution/product-frontier/product-frontier.json",
);
const outDir = resolve(args.out ?? "execution/products-consolidated");
const frontier = await readJson(frontierPath);
const allowedHosts = ["www.fredperry.com", "fredperry.com"];
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

function isSoft404Record(record) {
  const title = String(record.displayName ?? "").toLowerCase();
  return (
    record.validationReasons?.includes("SOFT_404_RESPONSE") ||
    /(?:^|\b)404(?:\b|$)/.test(title) ||
    /\bnot found\b/.test(title)
  );
}

function strictFailureReasons(record) {
  const reasons = new Set(record.validationReasons ?? []);
  if (!record.fetchOk) reasons.add("IDENTITY_CAPTURE_NOT_VALID");
  if (isSoft404Record(record)) reasons.add("SOFT_404_RESPONSE");
  if (!(record.imageReferences?.length > 0)) {
    reasons.add("NO_MATCHING_OFFICIAL_PRODUCT_IMAGE");
  }
  return [...reasons];
}

function strictCaptureValid(record) {
  return strictFailureReasons(record).length === 0;
}

const files = await walk(inputRoot);
const summaries = await Promise.all(
  files.filter(path => basename(path) === "summary.json").map(readJson),
);
const expectedSlots = Array.from(
  { length: 50 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);
const slots = new Set(summaries.map(summary => summary.slot));
const missing = expectedSlots.filter(slot => !slots.has(slot));
if (summaries.length !== 50 || slots.size !== 50 || missing.length) {
  throw new Error(
    `Product stage requires 50 unique summaries; got ${summaries.length}/${slots.size}; missing ${missing.join(",")}`,
  );
}
if (summaries.some(summary => summary.frontierSha256 !== frontier.frontierSha256)) {
  throw new Error("Product worker frontier hash mismatch");
}

const records = [];
for (const path of files.filter(
  path => basename(path) === "product-records.ndjson",
)) {
  const reader = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.frontierSha256 !== frontier.frontierSha256) {
      throw new Error(`Product record frontier mismatch in ${path}`);
    }
    records.push(record);
  }
}

const byIdentity = new Map();
for (const record of records) {
  const identityKey =
    record.identityKey ?? `${record.productCode}|${record.colourCode}`;
  const group = byIdentity.get(identityKey) ?? [];
  group.push({ ...record, identityKey });
  byIdentity.set(identityKey, group);
}

const identityRecords = [...byIdentity.entries()]
  .map(([identityKey, group]) => {
    const preferred = [...group].sort((a, b) => {
      const strictDelta =
        Number(strictCaptureValid(b)) - Number(strictCaptureValid(a));
      if (strictDelta) return strictDelta;
      const imageDelta =
        (b.imageReferences?.length ?? 0) -
        (a.imageReferences?.length ?? 0);
      if (imageDelta) return imageDelta;
      return (b.sourceBytes ?? 0) - (a.sourceBytes ?? 0);
    })[0];
    return {
      ...preferred,
      identityKey,
      strictCaptureValid: strictCaptureValid(preferred),
      strictFailureReasons: strictFailureReasons(preferred),
      duplicateIdentityCaptureCount: group.length,
      attemptedUrls: [
        ...new Set(
          group.flatMap(record =>
            (record.aliasAttempts ?? []).map(attempt => attempt.productUrl),
          ),
        ),
      ],
    };
  })
  .sort((a, b) => a.identityKey.localeCompare(b.identityKey));

const imageManifest = identityRecords.flatMap(record =>
  (record.imageReferences ?? []).map(image => ({
    identityKey: record.identityKey,
    productUrl: record.productUrl,
    productCode: record.productCode,
    colourCode: record.colourCode,
    sourcePageSha256: record.sourceSha256,
    ...image,
  })),
);
const invalidImages = imageManifest.filter(
  image => !isOfficialProductMedia(image.sourceUrl, allowedHosts),
);
if (invalidImages.length) {
  throw new Error(
    `Non-product or non-official image references reached consolidation: ${invalidImages.length}`,
  );
}

const expectedProductCaptureCount = Number(
  frontier.expectedProductCaptureCount ?? 0,
);
const successfulIdentityRecords = identityRecords.filter(
  record => record.strictCaptureValid,
);
const failedIdentityRecords = identityRecords.filter(
  record => !record.strictCaptureValid,
);
const acceptedImages = successfulIdentityRecords.flatMap(
  record => record.imageReferences ?? [],
);
const totals = {
  frontierProductUrlCount: frontier.uniqueProductUrlCount,
  frontierProductIdentityCount: frontier.uniqueProductIdentityCount,
  previouslyCompletedIdentityCount:
    frontier.previouslyCompletedIdentityCount ?? 0,
  selectedIdentityCount:
    frontier.selectedIdentityCount ?? expectedProductCaptureCount,
  expectedProductCaptureCount,
  attemptedProductCount: records.length,
  attemptedIdentityCount: identityRecords.length,
  httpFetchSuccessCount: records.filter(
    record => record.httpFetchOk ?? record.transportHttpStatus === 200,
  ).length,
  successfulProductFetchCount: records.filter(record => record.fetchOk).length,
  failedProductFetchCount: records.filter(record => !record.fetchOk).length,
  successfulIdentityCaptureCount: successfulIdentityRecords.length,
  failedIdentityCaptureCount: failedIdentityRecords.length,
  soft404IdentityCount: identityRecords.filter(isSoft404Record).length,
  missingImageIdentityCount: identityRecords.filter(
    record => !(record.imageReferences?.length > 0),
  ).length,
  aliasFallbackSuccessCount: identityRecords.filter(
    record => record.strictCaptureValid && record.aliasFallbackUsed,
  ).length,
  directSourceCount: records.filter(
    record =>
      record.sourceTransport === "DIRECT_OFFICIAL_HTTP" &&
      strictCaptureValid(record),
  ).length,
  transformedReaderSourceCount: records.filter(
    record =>
      record.sourceTransport ===
        "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" &&
      strictCaptureValid(record),
  ).length,
  imageReferenceCount: imageManifest.length,
  officialProductImageReferenceCount: acceptedImages.length,
  rejectedImageReferenceCount: invalidImages.length,
  descriptionEvidenceCount: successfulIdentityRecords.filter(
    record => Boolean(record.description),
  ).length,
  verifiedPriceCount: successfulIdentityRecords.filter(
    record => Boolean(record.observedPrice),
  ).length,
  materialEvidenceCount: successfulIdentityRecords.reduce(
    (sum, record) => sum + (record.materialSnippets?.length ?? 0),
    0,
  ),
  materialMissingIdentityCount: successfulIdentityRecords.filter(
    record => !(record.materialSnippets?.length > 0),
  ).length,
  manufacturingClaimCount: successfulIdentityRecords.reduce(
    (sum, record) => sum + (record.originSnippets?.length ?? 0),
    0,
  ),
  factoryVerifiedCount: 0,
};
const qualityGatePassed =
  summaries.length === 50 &&
  totals.attemptedIdentityCount === expectedProductCaptureCount &&
  totals.successfulIdentityCaptureCount === expectedProductCaptureCount &&
  totals.failedIdentityCaptureCount === 0 &&
  totals.soft404IdentityCount === 0 &&
  totals.missingImageIdentityCount === 0 &&
  invalidImages.length === 0;

const progressDelta = {
  schemaVersion: 2,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  selectedIdentitySha256: frontier.selectedIdentitySha256 ?? null,
  completedIdentityKeys: successfulIdentityRecords.map(
    record => record.identityKey,
  ),
  capturedProductUrlCount: new Set(
    successfulIdentityRecords.flatMap(
      record => record.aliasUrls ?? [record.productUrl],
    ),
  ).size,
  failedIdentities: failedIdentityRecords.map(record => ({
    identityKey: record.identityKey,
    productCode: record.productCode,
    colourCode: record.colourCode,
    requestedProductUrl: record.requestedProductUrl ?? record.productUrl,
    aliasUrls: record.aliasUrls ?? [record.productUrl],
    transportHttpStatus: record.transportHttpStatus ?? null,
    sourceTransport: record.sourceTransport ?? null,
    failureReasons: record.strictFailureReasons,
    fallbackError: record.fallbackError ?? record.error ?? null,
  })),
  counters: {
    successfulIdentityCaptureCount: successfulIdentityRecords.length,
    failedIdentityCaptureCount: failedIdentityRecords.length,
    officialProductImageReferenceCount: acceptedImages.length,
    materialEvidenceCount: totals.materialEvidenceCount,
    manufacturingClaimCount: totals.manufacturingClaimCount,
    factoryVerifiedCount: 0,
  },
  metadataGaps: {
    descriptionMissingIdentityCount:
      successfulIdentityRecords.length - totals.descriptionEvidenceCount,
    priceMissingIdentityCount:
      successfulIdentityRecords.length - totals.verifiedPriceCount,
    materialMissingIdentityCount: totals.materialMissingIdentityCount,
  },
  qualityGatePassed,
  status: qualityGatePassed
    ? "FULL_STRICT_IDENTITY_BATCH_ACCEPTED_NOT_GLOBAL_CANONICAL"
    : "PARTIAL_STRICT_IDENTITY_BATCH_REQUIRES_RETRY_NOT_GLOBAL_CANONICAL",
};
progressDelta.deltaSha256 = sha256(
  Buffer.from(JSON.stringify(progressDelta)),
);

const manifest = {
  schemaVersion: 5,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  workerCount: 50,
  orchestrationStatus: "FIFTY_OF_FIFTY_PRODUCT_WORKERS_CONSOLIDATED",
  transportStatus:
    totals.successfulIdentityCaptureCount > 0
      ? "USABLE_PRODUCT_SOURCES_CAPTURED"
      : "NO_USABLE_PRODUCT_SOURCES",
  contaminationStatus:
    invalidImages.length === 0
      ? "OFFICIAL_PRODUCT_MEDIA_ONLY"
      : "CONTAMINATION_DETECTED",
  qualityGatePassed,
  totals,
  productStatus:
    "CODE_COLOUR_IDENTITY_WITH_IMAGE_EVIDENCE_NOT_GLOBAL_CANONICAL_PRODUCTS",
  factoryStatus: "TEXTUAL_CLAIMS_ONLY_NO_FACTORY_VERIFICATION",
  imageStatus:
    "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
  priceStatus:
    "ONLY_DIRECT_OFFICIAL_PAGE_PRICE_CANDIDATES_RETAINED_REQUIRES_QA",
  progressDeltaSha256: progressDelta.deltaSha256,
  workerSummaries: summaries.sort((a, b) => a.slot.localeCompare(b.slot)),
  completedAt: new Date().toISOString(),
};
manifest.manifestSha256 = sha256(Buffer.from(JSON.stringify(manifest)));

await writeJson(`${outDir}/product-manifest.json`, manifest);
await writeJson(`${outDir}/product-progress-delta.json`, progressDelta);
await writeFile(
  `${outDir}/product-records.ndjson`,
  identityRecords.length
    ? `${identityRecords.map(record => JSON.stringify(record)).join("\n")}\n`
    : "",
  "utf8",
);
await writeFile(
  `${outDir}/image-manifest.ndjson`,
  imageManifest.length
    ? `${imageManifest.map(record => JSON.stringify(record)).join("\n")}\n`
    : "",
  "utf8",
);
await writeJson(
  `${outDir}/duplicate-product-captures.json`,
  [...byIdentity.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([identityKey, group]) => ({ identityKey, captures: group })),
);
console.log(JSON.stringify(manifest, null, 2));
