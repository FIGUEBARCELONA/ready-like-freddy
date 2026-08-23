import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeHtmlEntities,
  extractAttribute,
  isAllowedUrl,
  normalizeUrl,
  readJson,
  sha256,
  sleep,
  stripTags,
  writeJson,
} from "./common.mjs";
import { extractProductLinkCandidates } from "./product-extraction.mjs";
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
const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const outDir = resolve(args.out ?? `execution/workers/${slot}`);
const queue = await readJson(queuePath);
const assignment = queue.assignments.find(entry => entry.slot === slot);
if (!assignment) throw new Error(`No assignment found for ${slot}`);
const limit = Number(
  args.limit ?? process.env.RLF_PER_WORKER_LIMIT ?? queue.plan.pilotPerWorkerLimit ?? 1,
);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error(`Invalid per-worker limit: ${limit}`);
}
await mkdir(outDir, { recursive: true });
const recordsPath = `${outDir}/records.ndjson`;
const productLinksPath = `${outDir}/product-links.ndjson`;
await writeFile(recordsPath, "", "utf8");
await writeFile(productLinksPath, "", "utf8");
const records = [];
const productLinks = [];

function assetClassFor(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes("/media/catalog/product/")) return "PRODUCT_MEDIA";
    if (path.includes("/media/")) return "EDITORIAL_OR_SITE_MEDIA";
    return "PAGE_ASSET";
  } catch {
    return "UNKNOWN_ASSET";
  }
}

function collectImageUrls(content, baseUrl, allowedHosts, isHtml) {
  const values = [];
  if (isHtml) {
    const metaPatterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
      /<meta[^>]+name=["']twitter:image["'][^>]*>/gi,
    ];
    for (const pattern of metaPatterns) {
      for (const match of content.matchAll(pattern)) {
        const raw = extractAttribute(match[0], /.*/, "content");
        const normalized = raw ? normalizeUrl(raw, baseUrl) : null;
        if (normalized?.startsWith("https://")) values.push(normalized);
      }
    }
    for (const match of content.matchAll(
      /<img\b[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi,
    )) {
      const normalized = normalizeUrl(decodeHtmlEntities(match[1]), baseUrl);
      if (normalized?.startsWith("https://")) values.push(normalized);
    }
  }

  for (const match of content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+[^)]*)?\)/gi)) {
    values.push(decodeHtmlEntities(match[1]));
  }
  for (const match of content.matchAll(
    /https?:\/\/[^\s<>'")]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s<>'")]+)?/gi,
  )) {
    values.push(decodeHtmlEntities(match[0]));
  }

  return [...new Set(values)]
    .slice(0, 250)
    .map(url => ({
      sourceUrl: url,
      rightsStatus: "UNKNOWN",
      ingestionStatus: "NOT_INGESTED",
      hostAllowed: isAllowedUrl(url, allowedHosts),
      assetClass: assetClassFor(url),
    }));
}

function extractJsonLd(html) {
  const values = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      // The source hash preserves malformed JSON-LD without inventing fields.
    }
  }
  return values.flatMap(value => (Array.isArray(value) ? value : [value]));
}

function findProductNode(nodes) {
  return (
    nodes.find(
      node =>
        node &&
        typeof node === "object" &&
        ["Product", "ProductGroup"].includes(node["@type"]),
    ) ?? null
  );
}

function plainText(content, isHtml) {
  if (isHtml) return stripTags(content.slice(0, 1_000_000));
  return content
    .slice(0, 1_000_000)
    .replace(/^Title:\s*/gim, "")
    .replace(/^URL Source:\s*/gim, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_`~-]+/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

for (const entry of assignment.urls.slice(0, limit)) {
  const startedAt = new Date().toISOString();
  let record;
  try {
    const fetched = await fetchEvidenceSource(entry.url, {
      maxBytes: queue.plan.maxResponseBytes,
    });
    const response = fetched.response;
    const content = response.body.toString("utf8");
    const isHtml = /html/i.test(response.contentType) || /<html[\s>]/i.test(content.slice(0, 10_000));
    const titleMatch = isHtml
      ? content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      : content.match(/^Title:\s*(.+)$/im) ?? content.match(/^#\s+(.+)$/m);
    const ogTitleTag = isHtml
      ? content.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0] ?? ""
      : "";
    const canonicalTag = isHtml
      ? content.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? ""
      : "";
    const canonicalRaw = isHtml
      ? extractAttribute(canonicalTag, /.*/, "href")
      : content.match(/^URL Source:\s*(https?:\/\/\S+)$/im)?.[1] ?? null;
    const canonicalUrl = canonicalRaw ? normalizeUrl(canonicalRaw, entry.url) : entry.url;
    const jsonLdNodes = isHtml ? extractJsonLd(content) : [];
    const product = findProductNode(jsonLdNodes);
    const textSample = plainText(content, isHtml);
    const codeCandidates = [
      ...new Set(
        [
          ...entry.url.toUpperCase().matchAll(
            /(?:^|[-_/])([A-Z]{1,5}\d{3,6}(?:-[A-Z])?)(?=[-_/?.]|$)/g,
          ),
          ...textSample.toUpperCase().matchAll(/\b([A-Z]{1,5}\d{3,6}(?:-[A-Z])?)\b/g),
        ].map(match => match[1]),
      ),
    ].slice(0, 100);
    const modelName =
      typeof product?.name === "string"
        ? product.name.trim()
        : stripTags(
            extractAttribute(ogTitleTag, /.*/, "content") ?? titleMatch?.[1] ?? "",
          ) || null;
    const colourName = typeof product?.color === "string" ? product.color.trim() : null;
    const productCode =
      [product?.sku, product?.mpn, product?.productID]
        .find(value => typeof value === "string" && value.trim())
        ?.trim() ??
      codeCandidates[0] ??
      null;
    const images = collectImageUrls(
      content,
      entry.url,
      queue.allowedHosts ?? ["www.fredperry.com", "fredperry.com"],
      isHtml,
    );
    const fetchOk = response.ok;
    const pageSha256 = sha256(response.body);
    const extractedProductLinks = fetchOk
      ? extractProductLinkCandidates({
          content,
          baseUrl: entry.url,
          isHtml,
          allowedHosts: queue.allowedHosts ?? ["www.fredperry.com", "fredperry.com"],
          imageReferences: images,
          sourcePageUrl: entry.url,
          sourceSha256: pageSha256,
          sourceTransport: fetched.sourceTransport,
          observedAt: startedAt,
          queueId: queue.queueId,
          queueSha256: queue.queueSha256,
          slot,
        })
      : [];
    productLinks.push(...extractedProductLinks);
    if (extractedProductLinks.length) {
      await appendFile(
        productLinksPath,
        `${extractedProductLinks.map(candidate => JSON.stringify(candidate)).join("\n")}\n`,
        "utf8",
      );
    }

    record = {
      schemaVersion: 3,
      queueId: queue.queueId,
      queueSha256: queue.queueSha256,
      slot,
      sourceSeedLocale: entry.seedLocale,
      discoveryMethod: entry.discoveryMethod ?? null,
      requestedUrl: entry.url,
      finalUrl: entry.url,
      canonicalUrl,
      sourceTransport: fetched.sourceTransport,
      sourceFetchUrl: fetched.sourceFetchUrl,
      transportHttpStatus: response.status,
      fetchOk,
      contentType: response.contentType,
      sourceBytes: response.body.length,
      sourceSha256: pageSha256,
      originResponse: fetched.originResponse,
      fallbackError: fetched.fallbackError ?? null,
      observedAt: startedAt,
      title: modelName,
      productCode,
      productCodeCandidates: codeCandidates,
      modelName,
      colourName,
      structuredProductEvidence: Boolean(product),
      imageReferences: images,
      productLinkCandidateCount: extractedProductLinks.length,
      productMediaReferenceCount: images.filter(image => image.assetClass === "PRODUCT_MEDIA").length,
      uniquenessStatus: fetchOk
        ? "SOURCE_PAGE_REQUIRES_PRODUCT_LEVEL_EXPANSION"
        : "NOT_EVALUATED",
      evidenceStatus: fetchOk
        ? fetched.sourceTransport === "DIRECT_OFFICIAL_HTTP"
          ? "DIRECT_SOURCE_CAPTURED"
          : "TRANSFORMED_READER_SOURCE_CAPTURED"
        : "HTTP_RESPONSE_RECORDED_NO_USABLE_SOURCE",
    };
  } catch (error) {
    record = {
      schemaVersion: 3,
      queueId: queue.queueId,
      queueSha256: queue.queueSha256,
      slot,
      requestedUrl: entry.url,
      observedAt: startedAt,
      fetchOk: false,
      evidenceStatus: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
      uniquenessStatus: "NOT_EVALUATED",
    };
  }
  records.push(record);
  await appendFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await sleep(queue.plan.requestDelayMs ?? 750);
}

const uniqueProductLinks = new Map(productLinks.map(candidate => [candidate.productUrl, candidate]));
const summary = {
  schemaVersion: 3,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  slot,
  assignedUrlCount: assignment.urls.length,
  attemptedUrlCount: records.length,
  successfulFetchCount: records.filter(record => record.fetchOk).length,
  failedFetchCount: records.filter(record => !record.fetchOk).length,
  directSourceCount: records.filter(
    record => record.sourceTransport === "DIRECT_OFFICIAL_HTTP" && record.fetchOk,
  ).length,
  transformedReaderSourceCount: records.filter(
    record =>
      record.sourceTransport === "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE" &&
      record.fetchOk,
  ).length,
  structuredProductEvidenceCount: records.filter(record => record.structuredProductEvidence)
    .length,
  productCodeCandidateCount: new Set(
    records.flatMap(record => record.productCodeCandidates ?? []),
  ).size,
  imageReferenceCount: records.reduce(
    (sum, record) => sum + (record.imageReferences?.length ?? 0),
    0,
  ),
  productMediaReferenceCount: records.reduce(
    (sum, record) => sum + (record.productMediaReferenceCount ?? 0),
    0,
  ),
  productLinkCandidateCount: productLinks.length,
  uniqueProductUrlCount: uniqueProductLinks.size,
  completedAt: new Date().toISOString(),
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
