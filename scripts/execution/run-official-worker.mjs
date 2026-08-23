import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeHtmlEntities, extractAttribute, fetchBounded, isAllowedUrl, normalizeUrl, readJson, sha256, sleep, stripTags, writeJson } from "./common.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) throw new Error(`Invalid slot: ${slot}`);
const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const outDir = resolve(args.out ?? `execution/workers/${slot}`);
const queue = await readJson(queuePath);
const assignment = queue.assignments.find(entry => entry.slot === slot);
if (!assignment) throw new Error(`No assignment found for ${slot}`);
const limit = Number(args.limit ?? process.env.RLF_PER_WORKER_LIMIT ?? queue.plan.pilotPerWorkerLimit ?? 1);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`Invalid per-worker limit: ${limit}`);
await mkdir(outDir, { recursive: true });
const ndjsonPath = `${outDir}/records.ndjson`;
const records = [];

function collectImageUrls(html, baseUrl, allowedHosts) {
  const values = [];
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]*>/gi
  ];
  for (const pattern of metaPatterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = extractAttribute(match[0], /.*/, "content");
      const normalized = raw ? normalizeUrl(raw, baseUrl) : null;
      if (normalized?.startsWith("https://")) values.push(normalized);
    }
  }
  for (const match of html.matchAll(/<img\b[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const normalized = normalizeUrl(decodeHtmlEntities(match[1]), baseUrl);
    if (normalized?.startsWith("https://")) values.push(normalized);
  }
  return [...new Set(values)].slice(0, 20).map(url => ({
    sourceUrl: url,
    rightsStatus: "UNKNOWN",
    ingestionStatus: "NOT_INGESTED",
    hostAllowed: isAllowedUrl(url, allowedHosts)
  }));
}

function extractJsonLd(html) {
  const values = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      values.push(parsed);
    } catch {
      // Invalid JSON-LD remains covered by the page hash; no inferred values are created.
    }
  }
  return values.flatMap(value => Array.isArray(value) ? value : [value]);
}

function findProductNode(nodes) {
  return nodes.find(node => node && typeof node === "object" && ["Product", "ProductGroup"].includes(node["@type"])) ?? null;
}

for (const entry of assignment.urls.slice(0, limit)) {
  const startedAt = new Date().toISOString();
  let record;
  try {
    const response = await fetchBounded(entry.url, { maxBytes: queue.plan.maxResponseBytes });
    const html = response.body.toString("utf8");
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogTitleTag = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0] ?? "";
    const canonicalTag = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? "";
    const canonicalRaw = extractAttribute(canonicalTag, /.*/, "href");
    const canonicalUrl = canonicalRaw ? normalizeUrl(canonicalRaw, response.finalUrl) : null;
    const jsonLdNodes = extractJsonLd(html);
    const product = findProductNode(jsonLdNodes);
    const textSample = stripTags(html.slice(0, 1_000_000));
    const codeCandidates = [...new Set([
      ...response.finalUrl.toUpperCase().matchAll(/(?:^|[-_/])([A-Z]{1,4}\d{3,6})(?=[-_/?.]|$)/g),
      ...textSample.toUpperCase().matchAll(/\b([A-Z]{1,4}\d{3,6})\b/g)
    ].map(match => match[1]))].slice(0, 30);
    const modelName = typeof product?.name === "string"
      ? product.name.trim()
      : stripTags(extractAttribute(ogTitleTag, /.*/, "content") ?? titleMatch?.[1] ?? "") || null;
    const colourName = typeof product?.color === "string" ? product.color.trim() : null;
    const productCode = [product?.sku, product?.mpn, product?.productID].find(value => typeof value === "string" && value.trim())?.trim() ?? codeCandidates[0] ?? null;
    const images = collectImageUrls(html, response.finalUrl, queue.allowedHosts ?? ["www.fredperry.com", "fredperry.com"]);
    record = {
      schemaVersion: 1,
      queueId: queue.queueId,
      queueSha256: queue.queueSha256,
      slot,
      sourceSeedLocale: entry.seedLocale,
      requestedUrl: entry.url,
      finalUrl: response.finalUrl,
      canonicalUrl,
      httpStatus: response.status,
      fetchOk: response.ok,
      contentType: response.contentType,
      sourceBytes: response.body.length,
      sourceSha256: sha256(response.body),
      observedAt: startedAt,
      title: modelName,
      productCode,
      productCodeCandidates: codeCandidates,
      modelName,
      colourName,
      structuredProductEvidence: Boolean(product),
      imageReferences: images,
      uniquenessStatus: "CANDIDATE_REQUIRES_DEDUPLICATION",
      evidenceStatus: response.ok ? "SOURCE_CAPTURED" : "HTTP_RESPONSE_RECORDED"
    };
  } catch (error) {
    record = {
      schemaVersion: 1,
      queueId: queue.queueId,
      queueSha256: queue.queueSha256,
      slot,
      requestedUrl: entry.url,
      observedAt: startedAt,
      fetchOk: false,
      evidenceStatus: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
      uniquenessStatus: "NOT_EVALUATED"
    };
  }
  records.push(record);
  await appendFile(ndjsonPath, `${JSON.stringify(record)}\n`, "utf8");
  await sleep(queue.plan.requestDelayMs ?? 750);
}

const summary = {
  schemaVersion: 1,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  slot,
  assignedUrlCount: assignment.urls.length,
  attemptedUrlCount: records.length,
  successfulFetchCount: records.filter(record => record.fetchOk).length,
  failedFetchCount: records.filter(record => !record.fetchOk).length,
  structuredProductEvidenceCount: records.filter(record => record.structuredProductEvidence).length,
  productCodeCandidateCount: new Set(records.flatMap(record => record.productCodeCandidates ?? [])).size,
  imageReferenceCount: records.reduce((sum, record) => sum + (record.imageReferences?.length ?? 0), 0),
  completedAt: new Date().toISOString()
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
