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
const inputRoot = resolve(args.input ?? "execution/downloaded-product-workers");
const frontierPath = resolve(args.frontier ?? "execution/product-frontier/product-frontier.json");
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

const files = await walk(inputRoot);
const summaries = await Promise.all(files.filter(path => basename(path) === "summary.json").map(readJson));
const expectedSlots = Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`);
const slots = new Set(summaries.map(summary => summary.slot));
const missing = expectedSlots.filter(slot => !slots.has(slot));
if (summaries.length !== 50 || slots.size !== 50 || missing.length) {
  throw new Error(`Product stage requires 50 unique summaries; got ${summaries.length}/${slots.size}; missing ${missing.join(",")}`);
}
if (summaries.some(summary => summary.frontierSha256 !== frontier.frontierSha256)) {
  throw new Error("Product worker frontier hash mismatch");
}

const records = [];
for (const path of files.filter(path => basename(path) === "product-records.ndjson")) {
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.frontierSha256 !== frontier.frontierSha256) {
      throw new Error(`Product record frontier mismatch in ${path}`);
    }
    records.push(record);
  }
}

const byUrl = new Map();
for (const record of records) {
  const group = byUrl.get(record.productUrl) ?? [];
  group.push(record);
  byUrl.set(record.productUrl, group);
}
const uniqueRecords = [...byUrl.entries()]
  .map(([productUrl, group]) => {
    const preferred = [...group].sort((a, b) => {
      const fetchDelta = Number(Boolean(b.fetchOk)) - Number(Boolean(a.fetchOk));
      if (fetchDelta) return fetchDelta;
      return (b.imageReferences?.length ?? 0) - (a.imageReferences?.length ?? 0);
    })[0];
    return { ...preferred, productUrl, duplicateCaptureCount: group.length };
  })
  .sort((a, b) => a.productUrl.localeCompare(b.productUrl));
const imageManifest = uniqueRecords.flatMap(record =>
  (record.imageReferences ?? []).map(image => ({
    productUrl: record.productUrl,
    productCode: record.productCode,
    colourCode: record.colourCode,
    sourcePageSha256: record.sourceSha256,
    ...image,
  })),
);
const invalidImages = imageManifest.filter(image => !isOfficialProductMedia(image.sourceUrl, allowedHosts));
if (invalidImages.length) {
  throw new Error(`Non-product or non-official image references reached consolidation: ${invalidImages.length}`);
}
const totals = {
  frontierProductCount: frontier.uniqueProductUrlCount,
  attemptedProductCount: records.length,
  successfulProductFetchCount: records.filter(record => record.fetchOk).length,
  failedProductFetchCount: records.filter(record => !record.fetchOk).length,
  uniqueCapturedProductUrlCount: uniqueRecords.filter(record => record.fetchOk).length,
  directSourceCount: records.filter(record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk).length,
  transformedReaderSourceCount: records.filter(record => record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" && record.fetchOk).length,
  imageReferenceCount: imageManifest.length,
  officialProductImageReferenceCount: imageManifest.length,
  rejectedImageReferenceCount: invalidImages.length,
  materialEvidenceCount: records.reduce((sum, record) => sum + (record.materialSnippets?.length ?? 0), 0),
  manufacturingClaimCount: records.reduce((sum, record) => sum + (record.originSnippets?.length ?? 0), 0),
  factoryVerifiedCount: records.filter(record => record.factoryStatus === "VERIFIED").length,
};
const manifest = {
  schemaVersion: 2,
  runId: process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  workerCount: 50,
  orchestrationStatus: "FIFTY_OF_FIFTY_PRODUCT_WORKERS_CONSOLIDATED",
  transportStatus: totals.successfulProductFetchCount > 0 ? "USABLE_PRODUCT_SOURCES_CAPTURED" : "NO_USABLE_PRODUCT_SOURCES",
  contaminationStatus: invalidImages.length === 0 ? "OFFICIAL_PRODUCT_MEDIA_ONLY" : "CONTAMINATION_DETECTED",
  qualityGatePassed: summaries.length === 50 && totals.successfulProductFetchCount > 0 && invalidImages.length === 0,
  totals,
  productStatus: "PRODUCT_PAGE_EVIDENCE_CANDIDATES_NOT_CANONICAL_UNIQUE_PRODUCTS",
  factoryStatus: "TEXTUAL_CLAIMS_ONLY_NO_FACTORY_VERIFICATION",
  imageStatus: "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
  workerSummaries: summaries.sort((a, b) => a.slot.localeCompare(b.slot)),
  completedAt: new Date().toISOString(),
};
manifest.manifestSha256 = sha256(Buffer.from(JSON.stringify(manifest)));
await writeJson(`${outDir}/product-manifest.json`, manifest);
await writeFile(
  `${outDir}/product-records.ndjson`,
  uniqueRecords.length ? `${uniqueRecords.map(record => JSON.stringify(record)).join("\n")}\n` : "",
  "utf8",
);
await writeFile(
  `${outDir}/image-manifest.ndjson`,
  imageManifest.length ? `${imageManifest.map(record => JSON.stringify(record)).join("\n")}\n` : "",
  "utf8",
);
await writeJson(
  `${outDir}/duplicate-product-captures.json`,
  [...byUrl.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([productUrl, group]) => ({ productUrl, captures: group })),
);
console.log(JSON.stringify(manifest, null, 2));
