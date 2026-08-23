import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeHtmlEntities, isAllowedUrl, normalizeUrl, readJson, sha256, sleep, writeJson } from "./common.mjs";
import { extractProductPageFields } from "./product-extraction.mjs";
import { fetchEvidenceSource } from "./source-transport.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) throw new Error(`Invalid slot: ${slot}`);
const frontierPath = resolve(args.frontier ?? "execution/product-frontier/product-frontier.json");
const outDir = resolve(args.out ?? `execution/product-workers/${slot}`);
const frontier = await readJson(frontierPath);
if (frontier.workerCount !== 50) throw new Error(`Frontier workerCount must be 50, got ${frontier.workerCount}`);
const assignment = frontier.assignments.find(entry => entry.slot === slot);
if (!assignment) throw new Error(`No product assignment found for ${slot}`);
const limit = Number(args.limit ?? process.env.RLF_PRODUCT_PER_WORKER_LIMIT ?? 1);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`Invalid product limit: ${limit}`);
const maxBytes = Number(args.maxBytes ?? process.env.RLF_MAX_RESPONSE_BYTES ?? 8 * 1024 * 1024);
await mkdir(outDir, { recursive: true });
const recordsPath = `${outDir}/product-records.ndjson`;
await writeFile(recordsPath, "", "utf8");
const records = [];

function collectProductImages(content, productCode, colourCode, allowedHosts) {
  const values = [];
  for (const match of content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+[^)]*)?\)/gi)) {
    values.push(decodeHtmlEntities(match[1]));
  }
  for (const match of content.matchAll(/https?:\/\/[^\s<>'")]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s<>'")]+)?/gi)) {
    values.push(decodeHtmlEntities(match[0]));
  }
  for (const match of content.matchAll(/<img\b[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    values.push(decodeHtmlEntities(match[1]));
  }
  const codePattern = productCode ? productCode.replaceAll("-", "[-_]") : null;
  const identityPattern = codePattern && colourCode
    ? new RegExp(`${codePattern}[-_]${colourCode}(?:[-_.]|$)`, "i")
    : null;
  return [...new Set(values)]
    .map(value => normalizeUrl(value, "https://www.fredperry.com/"))
    .filter(Boolean)
    .filter(url => !identityPattern || identityPattern.test(decodeURIComponent(url)))
    .slice(0, 30)
    .map(sourceUrl => ({
      sourceUrl,
      rightsStatus: "UNKNOWN",
      ingestionStatus: "NOT_INGESTED",
      hostAllowed: isAllowedUrl(sourceUrl, allowedHosts),
      assetClass: "PRODUCT_MEDIA",
    }));
}

for (const candidate of assignment.products.slice(0, limit)) {
  const observedAt = new Date().toISOString();
  let record;
  try {
    const fetched = await fetchEvidenceSource(candidate.productUrl, { maxBytes });
    const response = fetched.response;
    const content = response.body.toString("utf8");
    const isHtml = /html/i.test(response.contentType) || /<html[\s>]/i.test(content.slice(0, 10_000));
    const fields = extractProductPageFields(content, candidate.productUrl, isHtml);
    const imageReferences = collectProductImages(
      content,
      fields.productCode,
      fields.colourCode,
      ["www.fredperry.com", "fredperry.com"],
    );
    record = {
      schemaVersion: 1,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      candidateKey: candidate.candidateKey,
      productUrl: candidate.productUrl,
      productCode: fields.productCode ?? candidate.productCode,
      colourCode: fields.colourCode ?? candidate.colourCode,
      displayName: fields.title ?? candidate.displayName,
      observedPrice: fields.observedPrice ?? candidate.observedPrice ?? null,
      description: fields.description,
      materialSnippets: fields.materialSnippets,
      originSnippets: fields.originSnippets,
      imageReferences,
      sourceTransport: fetched.sourceTransport,
      sourceFetchUrl: fetched.sourceFetchUrl,
      transportHttpStatus: response.status,
      fetchOk: response.ok,
      contentType: response.contentType,
      sourceBytes: response.body.length,
      sourceSha256: sha256(response.body),
      originResponse: fetched.originResponse,
      fallbackError: fetched.fallbackError ?? null,
      sourceCategoryPages: candidate.sourcePageUrls ?? [candidate.sourcePageUrl],
      sourceSlots: candidate.sourceSlots ?? [candidate.slot],
      observedAt,
      uniquenessStatus: "PRODUCT_PAGE_CAPTURED_REQUIRES_CROSS_SOURCE_DEDUPLICATION",
      canonicalStatus: "NOT_CANONICAL",
      imageStatus: "SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
    };
  } catch (error) {
    record = {
      schemaVersion: 1,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      productUrl: candidate.productUrl,
      productCode: candidate.productCode,
      colourCode: candidate.colourCode,
      observedAt,
      fetchOk: false,
      error: error instanceof Error ? error.message : String(error),
      canonicalStatus: "NOT_EVALUATED",
    };
  }
  records.push(record);
  await appendFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await sleep(750);
}

const summary = {
  schemaVersion: 1,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  slot,
  assignedProductCount: assignment.products.length,
  attemptedProductCount: records.length,
  successfulProductFetchCount: records.filter(record => record.fetchOk).length,
  failedProductFetchCount: records.filter(record => !record.fetchOk).length,
  directSourceCount: records.filter(record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk).length,
  transformedReaderSourceCount: records.filter(record => record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" && record.fetchOk).length,
  imageReferenceCount: records.reduce((sum, record) => sum + (record.imageReferences?.length ?? 0), 0),
  materialEvidenceCount: records.reduce((sum, record) => sum + (record.materialSnippets?.length ?? 0), 0),
  originEvidenceCount: records.reduce((sum, record) => sum + (record.originSnippets?.length ?? 0), 0),
  completedAt: new Date().toISOString(),
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
