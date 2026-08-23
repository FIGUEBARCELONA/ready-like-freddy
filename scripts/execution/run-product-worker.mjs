import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeHtmlEntities, normalizeUrl, readJson, sha256, sleep, writeJson } from "./common.mjs";
import { extractProductPageFields, isOfficialProductMedia } from "./product-extraction.mjs";
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
const requestedLimit = Number(args.limit ?? process.env.RLF_PRODUCT_PER_WORKER_LIMIT ?? 1);
const frontierLimit = Number(frontier.productPerWorkerLimit ?? 1);
const limit = Math.max(requestedLimit, frontierLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`Invalid product limit: ${limit}`);
const maxBytes = Number(args.maxBytes ?? process.env.RLF_MAX_RESPONSE_BYTES ?? 8 * 1024 * 1024);
const allowedHosts = ["www.fredperry.com", "fredperry.com"];
await mkdir(outDir, { recursive: true });
const recordsPath = `${outDir}/product-records.ndjson`;
await writeFile(recordsPath, "", "utf8");
const records = [];

function collectProductImages(content, productCode, colourCode) {
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
    .filter(url => isOfficialProductMedia(url, allowedHosts))
    .filter(url => !identityPattern || identityPattern.test(decodeURIComponent(new URL(url).pathname)))
    .slice(0, 30)
    .map(sourceUrl => ({
      sourceUrl,
      rightsStatus: "UNKNOWN",
      ingestionStatus: "NOT_INGESTED",
      hostAllowed: true,
      assetClass: "PRODUCT_MEDIA",
    }));
}

async function fetchIdentityCandidate(candidate) {
  const urls = [...new Set([candidate.preferredProductUrl, candidate.productUrl, ...(candidate.aliasUrls ?? [])].filter(Boolean))];
  const aliasAttempts = [];
  let last = null;

  for (const productUrl of urls) {
    const fetched = await fetchEvidenceSource(productUrl, {
      maxBytes,
      directAttempts: 2,
      readerAttempts: 3,
    });
    aliasAttempts.push({
      productUrl,
      fetchOk: fetched.response.ok,
      sourceTransport: fetched.sourceTransport,
      transportHttpStatus: fetched.response.status,
      sourceFetchUrl: fetched.sourceFetchUrl,
      transportAttempts: fetched.transportAttempts ?? [],
    });
    last = { productUrl, fetched };
    if (fetched.response.ok) return { productUrl, fetched, aliasAttempts };
  }

  return { productUrl: last?.productUrl ?? candidate.productUrl, fetched: last?.fetched ?? null, aliasAttempts };
}

for (const candidate of assignment.products.slice(0, limit)) {
  const observedAt = new Date().toISOString();
  let record;
  try {
    const result = await fetchIdentityCandidate(candidate);
    if (!result.fetched) throw new Error(`No source transport result for ${candidate.identityKey ?? candidate.candidateKey}`);
    const { fetched, productUrl, aliasAttempts } = result;
    const response = fetched.response;
    const content = response.body.toString("utf8");
    const isHtml = /html/i.test(response.contentType) || /<html[\s>]/i.test(content.slice(0, 10_000));
    const fields = extractProductPageFields(content, productUrl, isHtml);
    const productCode = fields.productCode ?? candidate.productCode;
    const colourCode = fields.colourCode ?? candidate.colourCode;
    const identityKey = candidate.identityKey ?? `${productCode}|${colourCode}`;
    const imageReferences = response.ok ? collectProductImages(content, productCode, colourCode) : [];
    record = {
      schemaVersion: 3,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      candidateKey: candidate.candidateKey,
      identityKey,
      requestedProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      productUrl,
      preferredProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      aliasUrls: candidate.aliasUrls ?? [candidate.productUrl],
      aliasAttempts,
      aliasFallbackUsed: productUrl !== (candidate.preferredProductUrl ?? candidate.productUrl),
      productCode,
      colourCode,
      displayName: fields.title ?? candidate.displayName,
      observedPrice: fields.observedPrice ?? candidate.observedPrice ?? null,
      description: fields.description,
      materialSnippets: fields.materialSnippets,
      originSnippets: fields.originSnippets,
      originEvidenceStatus: fields.originEvidenceStatus,
      imageReferences,
      sourceTransport: fetched.sourceTransport,
      sourceFetchUrl: fetched.sourceFetchUrl,
      transportAttempts: fetched.transportAttempts ?? [],
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
      uniquenessStatus: response.ok
        ? "CODE_COLOUR_IDENTITY_CAPTURED_REQUIRES_GLOBAL_REVIEW"
        : "IDENTITY_NOT_CAPTURED",
      canonicalStatus: "NOT_GLOBAL_CANONICAL",
      factoryStatus: "NOT_VERIFIED",
      imageStatus: "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED",
    };
  } catch (error) {
    record = {
      schemaVersion: 3,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      candidateKey: candidate.candidateKey,
      identityKey: candidate.identityKey ?? `${candidate.productCode}|${candidate.colourCode}`,
      requestedProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      productUrl: candidate.productUrl,
      aliasUrls: candidate.aliasUrls ?? [candidate.productUrl],
      productCode: candidate.productCode,
      colourCode: candidate.colourCode,
      observedAt,
      fetchOk: false,
      error: error instanceof Error ? error.message : String(error),
      canonicalStatus: "NOT_EVALUATED",
      factoryStatus: "NOT_EVALUATED",
    };
  }
  records.push(record);
  await appendFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await sleep(750);
}

const summary = {
  schemaVersion: 3,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  slot,
  configuredProductLimit: frontierLimit,
  assignedProductCount: assignment.products.length,
  expectedProductCount: Math.min(frontierLimit, assignment.products.length),
  attemptedProductCount: records.length,
  successfulProductFetchCount: records.filter(record => record.fetchOk).length,
  failedProductFetchCount: records.filter(record => !record.fetchOk).length,
  aliasFallbackSuccessCount: records.filter(record => record.fetchOk && record.aliasFallbackUsed).length,
  directSourceCount: records.filter(record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk).length,
  transformedReaderSourceCount: records.filter(record => record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" && record.fetchOk).length,
  imageReferenceCount: records.reduce((sum, record) => sum + (record.imageReferences?.length ?? 0), 0),
  materialEvidenceCount: records.reduce((sum, record) => sum + (record.materialSnippets?.length ?? 0), 0),
  manufacturingClaimCount: records.reduce((sum, record) => sum + (record.originSnippets?.length ?? 0), 0),
  factoryVerifiedCount: 0,
  completedAt: new Date().toISOString(),
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
