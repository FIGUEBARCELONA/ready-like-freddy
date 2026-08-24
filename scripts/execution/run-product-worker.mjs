import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeHtmlEntities,
  normalizeUrl,
  readJson,
  sha256,
  sleep,
  writeJson,
} from "./common.mjs";
import {
  extractProductPageFields,
  isOfficialProductMedia,
} from "./product-extraction.mjs";
import { fetchEvidenceSource } from "./source-transport.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) {
  throw new Error(`Invalid slot: ${slot}`);
}
const frontierPath = resolve(
  args.frontier ?? "execution/product-frontier/product-frontier.json",
);
const outDir = resolve(args.out ?? `execution/product-workers/${slot}`);
const frontier = await readJson(frontierPath);
if (frontier.workerCount !== 50) {
  throw new Error(`Frontier workerCount must be 50, got ${frontier.workerCount}`);
}
const assignment = frontier.assignments.find(entry => entry.slot === slot);
if (!assignment) throw new Error(`No product assignment found for ${slot}`);
const requestedLimit = Number(
  args.limit ?? process.env.RLF_PRODUCT_PER_WORKER_LIMIT ?? 1,
);
const frontierLimit = Number(frontier.productPerWorkerLimit ?? 1);
const limit = Math.max(requestedLimit, frontierLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error(`Invalid product limit: ${limit}`);
}
const maxBytes = Number(
  args.maxBytes ?? process.env.RLF_MAX_RESPONSE_BYTES ?? 8 * 1024 * 1024,
);
const allowedHosts = ["www.fredperry.com", "fredperry.com"];
await mkdir(outDir, { recursive: true });
const recordsPath = `${outDir}/product-records.ndjson`;
await writeFile(recordsPath, "", "utf8");
const records = [];

function collectProductImages(content, productCode, colourCode) {
  const values = [];
  for (const match of content.matchAll(
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+[^)]*)?\)/gi,
  )) {
    values.push(decodeHtmlEntities(match[1]));
  }
  for (const match of content.matchAll(
    /https?:\/\/[^\s<>'")]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s<>'")]+)?/gi,
  )) {
    values.push(decodeHtmlEntities(match[0]));
  }
  for (const match of content.matchAll(
    /<img\b[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    values.push(decodeHtmlEntities(match[1]));
  }
  const codePattern = productCode ? productCode.replaceAll("-", "[-_]") : null;
  const identityPattern =
    codePattern && colourCode
      ? new RegExp(`${codePattern}[-_]${colourCode}(?:[-_.]|$)`, "i")
      : null;
  return [...new Set(values)]
    .map(value => normalizeUrl(value, "https://www.fredperry.com/"))
    .filter(Boolean)
    .filter(url => isOfficialProductMedia(url, allowedHosts))
    .filter(
      url =>
        !identityPattern ||
        identityPattern.test(decodeURIComponent(new URL(url).pathname)),
    )
    .slice(0, 30)
    .map(sourceUrl => ({
      sourceUrl,
      rightsStatus: "UNKNOWN",
      ingestionStatus: "NOT_INGESTED",
      hostAllowed: true,
      assetClass: "PRODUCT_MEDIA",
    }));
}

function isSoft404(fields, content) {
  const title = String(fields?.title ?? "").toLowerCase();
  const head = content.slice(0, 5_000).toLowerCase();
  return (
    /(?:^|\b)404(?:\b|$)/.test(title) ||
    /\bnot found\b/.test(title) ||
    /\bpage not found\b/.test(title) ||
    /(?:^|\n)\s*404\s+not found\b/.test(head)
  );
}

function validationReasons(response, fields, content, imageReferences) {
  const reasons = [];
  if (!response?.ok) reasons.push("HTTP_SOURCE_NOT_USABLE");
  if (isSoft404(fields, content)) reasons.push("SOFT_404_RESPONSE");
  if (!imageReferences.length) {
    reasons.push("NO_MATCHING_OFFICIAL_PRODUCT_IMAGE");
  }
  return reasons;
}

function candidateScore(result) {
  if (!result) return -1;
  let score = 0;
  if (result.response?.ok) score += 10;
  if (!result.validationReasons.includes("SOFT_404_RESPONSE")) score += 20;
  score += result.imageReferences.length * 100;
  score += result.fields?.materialSnippets?.length ?? 0;
  return score;
}

async function fetchIdentityCandidate(candidate) {
  const urls = [
    ...new Set(
      [
        candidate.preferredProductUrl,
        candidate.productUrl,
        ...(candidate.aliasUrls ?? []),
      ].filter(Boolean),
    ),
  ];
  const aliasAttempts = [];
  let best = null;

  for (const productUrl of urls) {
    try {
      const fetched = await fetchEvidenceSource(productUrl, {
        maxBytes,
        directAttempts: 2,
        readerAttempts: 3,
      });
      const response = fetched.response;
      const content = response.body.toString("utf8");
      const isHtml =
        /html/i.test(response.contentType) ||
        /<html[\s>]/i.test(content.slice(0, 10_000));
      const fields = extractProductPageFields(content, productUrl, isHtml);
      const productCode = fields.productCode ?? candidate.productCode;
      const colourCode = fields.colourCode ?? candidate.colourCode;
      const imageReferences = response.ok
        ? collectProductImages(content, productCode, colourCode)
        : [];
      const reasons = validationReasons(
        response,
        fields,
        content,
        imageReferences,
      );
      const attempt = {
        productUrl,
        httpFetchOk: response.ok,
        captureValid: reasons.length === 0,
        validationReasons: reasons,
        sourceTransport: fetched.sourceTransport,
        transportHttpStatus: response.status,
        sourceFetchUrl: fetched.sourceFetchUrl,
        transportAttempts: fetched.transportAttempts ?? [],
      };
      aliasAttempts.push(attempt);
      const current = {
        productUrl,
        fetched,
        response,
        content,
        isHtml,
        fields,
        productCode,
        colourCode,
        imageReferences,
        validationReasons: reasons,
      };
      if (!best || candidateScore(current) > candidateScore(best)) best = current;
      if (reasons.length === 0) {
        return { ...current, aliasAttempts, captureValid: true };
      }
    } catch (error) {
      aliasAttempts.push({
        productUrl,
        httpFetchOk: false,
        captureValid: false,
        validationReasons: ["SOURCE_TRANSPORT_EXCEPTION"],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ...best,
    productUrl: best?.productUrl ?? candidate.productUrl,
    aliasAttempts,
    captureValid: false,
    validationReasons:
      best?.validationReasons?.length
        ? best.validationReasons
        : ["NO_USABLE_ALIAS_CAPTURE"],
  };
}

for (const candidate of assignment.products.slice(0, limit)) {
  const observedAt = new Date().toISOString();
  let record;
  try {
    const result = await fetchIdentityCandidate(candidate);
    const productCode = result.productCode ?? candidate.productCode;
    const colourCode = result.colourCode ?? candidate.colourCode;
    const identityKey = candidate.identityKey ?? `${productCode}|${colourCode}`;
    const fetched = result.fetched ?? null;
    const response = result.response ?? null;
    const fields = result.fields ?? {
      title: candidate.displayName ?? null,
      description: null,
      materialSnippets: [],
      originSnippets: [],
      originEvidenceStatus: "NO_MANUFACTURING_CLAIM_CAPTURED",
      observedPrice: null,
    };
    const captureValid = Boolean(result.captureValid);
    const directPrice =
      captureValid &&
      fetched?.sourceTransport === "DIRECT_OFFICIAL_HTTP" &&
      fields.observedPrice
        ? fields.observedPrice
        : null;
    record = {
      schemaVersion: 4,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      candidateKey: candidate.candidateKey,
      identityKey,
      requestedProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      productUrl: result.productUrl,
      preferredProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      aliasUrls: candidate.aliasUrls ?? [candidate.productUrl],
      aliasAttempts: result.aliasAttempts,
      aliasFallbackUsed:
        captureValid &&
        result.productUrl !== (candidate.preferredProductUrl ?? candidate.productUrl),
      productCode,
      colourCode,
      displayName: fields.title ?? candidate.displayName ?? null,
      observedPrice: directPrice,
      priceEvidenceStatus: directPrice
        ? "DIRECT_OFFICIAL_PAGE_PRICE_CANDIDATE_REQUIRES_QA"
        : "NO_VERIFIED_PRICE_CAPTURED",
      description: fields.description ?? null,
      materialSnippets: fields.materialSnippets ?? [],
      originSnippets: fields.originSnippets ?? [],
      originEvidenceStatus:
        fields.originEvidenceStatus ?? "NO_MANUFACTURING_CLAIM_CAPTURED",
      imageReferences: result.imageReferences ?? [],
      sourceTransport: fetched?.sourceTransport ?? null,
      sourceFetchUrl: fetched?.sourceFetchUrl ?? null,
      transportAttempts: fetched?.transportAttempts ?? [],
      transportHttpStatus: response?.status ?? null,
      httpFetchOk: Boolean(response?.ok),
      fetchOk: captureValid,
      captureStatus: captureValid
        ? "IDENTITY_AND_OFFICIAL_IMAGE_CAPTURED"
        : "IDENTITY_CAPTURE_REQUIRES_RETRY",
      validationReasons: result.validationReasons ?? [],
      contentType: response?.contentType ?? null,
      sourceBytes: response?.body?.length ?? 0,
      sourceSha256: response?.body ? sha256(response.body) : null,
      originResponse: fetched?.originResponse ?? null,
      fallbackError: fetched?.fallbackError ?? null,
      sourceCategoryPages: candidate.sourcePageUrls ?? [candidate.sourcePageUrl],
      sourceSlots: candidate.sourceSlots ?? [candidate.slot],
      observedAt,
      uniquenessStatus: captureValid
        ? "CODE_COLOUR_IDENTITY_WITH_IMAGE_CAPTURED_REQUIRES_GLOBAL_REVIEW"
        : "IDENTITY_NOT_COMPLETELY_CAPTURED",
      canonicalStatus: "NOT_GLOBAL_CANONICAL",
      factoryStatus: "NOT_VERIFIED",
      imageStatus: captureValid
        ? "OFFICIAL_SOURCE_URLS_ONLY_RIGHTS_UNKNOWN_NOT_INGESTED"
        : "NO_MATCHING_OFFICIAL_PRODUCT_IMAGE",
    };
  } catch (error) {
    record = {
      schemaVersion: 4,
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      slot,
      candidateKey: candidate.candidateKey,
      identityKey:
        candidate.identityKey ??
        `${candidate.productCode}|${candidate.colourCode}`,
      requestedProductUrl: candidate.preferredProductUrl ?? candidate.productUrl,
      productUrl: candidate.productUrl,
      aliasUrls: candidate.aliasUrls ?? [candidate.productUrl],
      productCode: candidate.productCode,
      colourCode: candidate.colourCode,
      observedAt,
      httpFetchOk: false,
      fetchOk: false,
      captureStatus: "IDENTITY_CAPTURE_REQUIRES_RETRY",
      validationReasons: ["UNHANDLED_WORKER_EXCEPTION"],
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
  schemaVersion: 4,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  slot,
  configuredProductLimit: frontierLimit,
  assignedProductCount: assignment.products.length,
  expectedProductCount: Math.min(frontierLimit, assignment.products.length),
  attemptedProductCount: records.length,
  successfulProductFetchCount: records.filter(record => record.fetchOk).length,
  failedProductFetchCount: records.filter(record => !record.fetchOk).length,
  httpFetchSuccessCount: records.filter(record => record.httpFetchOk).length,
  soft404Count: records.filter(record =>
    record.validationReasons?.includes("SOFT_404_RESPONSE"),
  ).length,
  missingImageCount: records.filter(record =>
    record.validationReasons?.includes("NO_MATCHING_OFFICIAL_PRODUCT_IMAGE"),
  ).length,
  aliasFallbackSuccessCount: records.filter(
    record => record.fetchOk && record.aliasFallbackUsed,
  ).length,
  directSourceCount: records.filter(
    record =>
      record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk,
  ).length,
  transformedReaderSourceCount: records.filter(
    record =>
      record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" &&
      record.fetchOk,
  ).length,
  imageReferenceCount: records.reduce(
    (sum, record) => sum + (record.imageReferences?.length ?? 0),
    0,
  ),
  materialEvidenceCount: records.reduce(
    (sum, record) => sum + (record.materialSnippets?.length ?? 0),
    0,
  ),
  manufacturingClaimCount: records.reduce(
    (sum, record) => sum + (record.originSnippets?.length ?? 0),
    0,
  ),
  verifiedPriceCount: records.filter(record => record.observedPrice).length,
  factoryVerifiedCount: 0,
  completedAt: new Date().toISOString(),
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
