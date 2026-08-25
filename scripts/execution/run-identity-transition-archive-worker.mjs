import { gunzipSync } from "node:zlib";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";
import { fetchEvidenceSource } from "./source-transport.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) {
  throw new Error(`Invalid slot ${slot}`);
}
const frontierPath = resolve(
  args.frontier ??
    "execution/identity-transition-frontier/identity-transition-frontier.json",
);
const outDir = resolve(
  args.out ?? `execution/sequence18-identity-workers/${slot}`,
);
const frontier = await readJson(frontierPath);
if (
  frontier.targetSequence !== 18 ||
  frontier.workerCount !== 50 ||
  frontier.ledgerMutationAllowed !== false
) {
  throw new Error("Invalid sequence 18 frontier policy");
}
const assignment = frontier.assignments.find(item => item.slot === slot);
if (!assignment) throw new Error(`Missing assignment ${slot}`);

await mkdir(`${outDir}/responses`, { recursive: true });
const recordsPath = `${outDir}/observations.ndjson`;
await writeFile(recordsPath, "", "utf8");
const observations = [];
let responseIndex = 0;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOfficialFredPerryUrl(value, { requireHttps = true } = {}) {
  try {
    const url = new URL(value);
    const protocolAllowed = requireHttps
      ? url.protocol === "https:"
      : ["http:", "https:"].includes(url.protocol);
    return (
      protocolAllowed &&
      (url.hostname === "fredperry.com" ||
        url.hostname.endsWith(".fredperry.com"))
    );
  } catch {
    return false;
  }
}

function normalizeOfficialUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|gclid|fbclid|ref$|source$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return isOfficialFredPerryUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

function productIdentityFromUrl(value) {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    const match = path.match(
      /-([a-z]{1,8}\d{3,6}[a-z]?)-([a-z0-9]{2,5})\.html$/i,
    );
    if (!match) return null;
    return {
      productCode: match[1].toUpperCase(),
      colourCode: match[2].toUpperCase(),
    };
  } catch {
    return null;
  }
}

function isOfficialProductMedia(value) {
  if (!isOfficialFredPerryUrl(value)) return false;
  try {
    const path = new URL(value).pathname.toLowerCase();
    return (
      path.includes("/media/catalog/product/") &&
      /\.(?:jpe?g|png|webp|gif)$/i.test(path)
    );
  } catch {
    return false;
  }
}

function mediaIdentityForCandidate(value, candidate) {
  if (!isOfficialProductMedia(value)) return null;
  const path = decodeURIComponent(new URL(value).pathname).toUpperCase();
  const base = escapeRegExp(candidate.productCode.toUpperCase());
  const match = path.match(
    new RegExp(`(?:^|/)(${base}[A-Z]?)[-_]([A-Z0-9]{2,5})(?:[-_.]|$)`),
  );
  if (!match) return null;
  return { productCode: match[1], colourCode: match[2] };
}

function isPermittedAdjacentCode(candidate, value) {
  if (!candidate.transitionProbeEnabled) return false;
  const base = candidate.productCode.toUpperCase();
  const observed = String(value ?? "").toUpperCase();
  return (
    observed.length === base.length + 1 &&
    observed.startsWith(base) &&
    /^[A-Z]$/.test(observed.slice(-1))
  );
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractOfficialUrls(content, baseUrl) {
  const values = [];
  for (const match of content.matchAll(
    /https?:\/\/(?:[a-z0-9-]+\.)?fredperry\.com\/[^\s<>'"\])}]+/gi,
  )) {
    values.push(match[0]);
  }
  for (const match of content.matchAll(
    /\b(?:href|src|data-src)\s*=\s*["']([^"']+)["']/gi,
  )) {
    values.push(match[1]);
  }
  for (const match of content.matchAll(
    /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gi,
  )) {
    values.push(match[1]);
  }
  return [
    ...new Set(
      values
        .map(value => decodeHtmlEntities(value).replace(/[.,;:]+$/, ""))
        .map(value => normalizeOfficialUrl(value, baseUrl))
        .filter(Boolean),
    ),
  ].sort();
}

function hasSkuStatement(content, productCode, colourCode) {
  const code = escapeRegExp(productCode);
  const colour = escapeRegExp(colourCode);
  const patterns = [
    new RegExp(
      `\\bSKU\\s*(?:[|:=]|&nbsp;|<[^>]+>)*\\s*${code}[-_]${colour}\\b`,
      "i",
    ),
    new RegExp(
      `["']sku["']\\s*:\\s*["']${code}[-_]${colour}["']`,
      "i",
    ),
    new RegExp(
      `\\bproduct[-_ ]sku\\b[^\\r\\n]{0,120}${code}[-_]${colour}\\b`,
      "i",
    ),
  ];
  return patterns.some(pattern => pattern.test(content));
}

function isSoft404(content) {
  const head = content.slice(0, 12_000).toLowerCase();
  return (
    /(?:^|\n)\s*(?:title:\s*)?404(?:\s+not found)?\s*(?:\n|$)/i.test(head) ||
    /<title[^>]*>[^<]*(?:404|page not found|not found)[^<]*<\/title>/i.test(
      head,
    )
  );
}

function emptyAnalysis(candidate, pageUrl) {
  return {
    pageIdentity: productIdentityFromUrl(pageUrl),
    soft404: null,
    exactBaseSkuStatementObserved: false,
    sourcePageSkuStatementObserved: false,
    officialUrlCount: 0,
    officialMediaUrlCount: 0,
    discoveredProductUrls: [],
    exactMediaCandidates: [],
    transitionBridgeCandidates: [],
    rejectedIdentityMedia: [],
    candidateIdentityKey: candidate.identityKey,
  };
}

function analyzeCapturedPage(candidate, pageUrl, content, sourceClass) {
  const pageIdentity = productIdentityFromUrl(pageUrl);
  const soft404 = isSoft404(content);
  const officialUrls = extractOfficialUrls(content, pageUrl);
  const officialMediaUrls = officialUrls.filter(isOfficialProductMedia);
  const discoveredProductUrls = officialUrls
    .map(url => ({ url, identity: productIdentityFromUrl(url) }))
    .filter(item => item.identity)
    .filter(
      item =>
        item.identity.colourCode === candidate.colourCode &&
        (item.identity.productCode === candidate.productCode ||
          isPermittedAdjacentCode(candidate, item.identity.productCode)),
    )
    .map(item => ({
      productUrl: item.url,
      productCode: item.identity.productCode,
      colourCode: item.identity.colourCode,
      relation:
        item.identity.productCode === candidate.productCode
          ? "EXACT_BASE_CODE"
          : "ONE_TERMINAL_LETTER_CODE_VARIANT",
    }));
  const uniqueDiscovered = [
    ...new Map(discoveredProductUrls.map(item => [item.productUrl, item])).values(),
  ].sort((a, b) => a.productUrl.localeCompare(b.productUrl));

  const exactBaseSkuStatementObserved = hasSkuStatement(
    content,
    candidate.productCode,
    candidate.colourCode,
  );
  const sourcePageSkuStatementObserved = pageIdentity
    ? hasSkuStatement(content, pageIdentity.productCode, pageIdentity.colourCode)
    : false;
  const exactMediaCandidates = [];
  const transitionBridgeCandidates = [];
  const rejectedIdentityMedia = [];

  for (const mediaUrl of officialMediaUrls) {
    const mediaIdentity = mediaIdentityForCandidate(mediaUrl, candidate);
    if (!mediaIdentity) continue;
    const sameColour = mediaIdentity.colourCode === candidate.colourCode;
    const baseCodeMedia =
      mediaIdentity.productCode === candidate.productCode;
    const adjacentCodeMedia = isPermittedAdjacentCode(
      candidate,
      mediaIdentity.productCode,
    );
    const exactBaseMedia =
      baseCodeMedia && sameColour;
    const adjacentMedia =
      adjacentCodeMedia && sameColour;
    const pageIsExactBase =
      pageIdentity?.productCode === candidate.productCode &&
      pageIdentity?.colourCode === candidate.colourCode;
    const pageIsAdjacent =
      pageIdentity?.colourCode === candidate.colourCode &&
      isPermittedAdjacentCode(candidate, pageIdentity?.productCode);

    if (
      exactBaseMedia &&
      pageIsExactBase &&
      exactBaseSkuStatementObserved &&
      !soft404
    ) {
      exactMediaCandidates.push({
        identityKey: candidate.identityKey,
        sourcePageUrl: pageUrl,
        sourceClass,
        mediaUrl,
        mediaProductCode: mediaIdentity.productCode,
        mediaColourCode: mediaIdentity.colourCode,
        evidenceGate:
          "EXACT_OFFICIAL_PAGE_SKU_AND_EXACT_CODE_COLOUR_MEDIA_CO_OCCURRENCE",
        rightsStatus: "UNKNOWN",
        ingestionStatus: "NOT_INGESTED",
        strictCandidate: true,
      });
      continue;
    }

    const basePageEmbedsAdjacentMedia =
      pageIsExactBase &&
      exactBaseSkuStatementObserved &&
      adjacentMedia &&
      !soft404;
    const adjacentPageEmbedsBaseMedia =
      pageIsAdjacent &&
      sourcePageSkuStatementObserved &&
      exactBaseMedia &&
      !soft404;
    if (basePageEmbedsAdjacentMedia || adjacentPageEmbedsBaseMedia) {
      transitionBridgeCandidates.push({
        identityKey: candidate.identityKey,
        sourcePageUrl: pageUrl,
        sourcePageProductCode: pageIdentity.productCode,
        sourcePageColourCode: pageIdentity.colourCode,
        sourceClass,
        mediaUrl,
        mediaProductCode: mediaIdentity.productCode,
        mediaColourCode: mediaIdentity.colourCode,
        bridgeType: basePageEmbedsAdjacentMedia
          ? "EXACT_BASE_SKU_PAGE_EMBEDS_ADJACENT_CODE_MEDIA"
          : "ADJACENT_SKU_PAGE_EMBEDS_EXACT_BASE_CODE_MEDIA",
        sameOfficialPageCrossCodeMediaAssociation: true,
        sameColourOrNameAloneUsed: false,
        automaticAliasPromotionAllowed: false,
        bridgeCandidate: true,
      });
      continue;
    }

    rejectedIdentityMedia.push({
      mediaUrl,
      mediaProductCode: mediaIdentity.productCode,
      mediaColourCode: mediaIdentity.colourCode,
      rejectionReasons: [
        ...(!sameColour ? ["MEDIA_COLOUR_CODE_MISMATCH"] : []),
        ...(!baseCodeMedia && !adjacentCodeMedia
          ? ["MEDIA_PRODUCT_CODE_NOT_EXACT_OR_PERMITTED_ADJACENT"]
          : []),
        ...(soft404 ? ["SOURCE_PAGE_SOFT_404"] : []),
        ...(!pageIdentity ? ["SOURCE_NOT_EXACT_PRODUCT_PAGE"] : []),
        ...(pageIdentity && !sourcePageSkuStatementObserved
          ? ["SOURCE_PAGE_EXACT_SKU_STATEMENT_NOT_OBSERVED"]
          : []),
        ...(exactBaseMedia && pageIsAdjacent
          ? ["EXACT_MEDIA_ON_ADJACENT_PAGE_REQUIRES_EXPLICIT_BRIDGE"]
          : []),
        ...(adjacentMedia && pageIsAdjacent
          ? ["ADJACENT_CODE_PAGE_AND_MEDIA_DO_NOT_ESTABLISH_BASE_CODE_ALIAS"]
          : []),
      ],
    });
  }

  return {
    pageIdentity,
    soft404,
    exactBaseSkuStatementObserved,
    sourcePageSkuStatementObserved,
    officialUrlCount: officialUrls.length,
    officialMediaUrlCount: officialMediaUrls.length,
    discoveredProductUrls: uniqueDiscovered,
    exactMediaCandidates,
    transitionBridgeCandidates,
    rejectedIdentityMedia: rejectedIdentityMedia.slice(0, 100),
    candidateIdentityKey: candidate.identityKey,
  };
}

function responseMetadata(response) {
  if (!response) return null;
  return {
    httpStatus: response.status,
    ok: response.ok,
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    sourceBytes: response.body.length,
    sourceSha256: sha256(response.body),
    attempt: response.attempt ?? null,
  };
}

async function persistBody(prefix, body) {
  responseIndex += 1;
  const safePrefix = String(prefix)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  const relativePath =
    `responses/${String(responseIndex).padStart(3, "0")}-${safePrefix || "response"}.body`;
  await writeFile(`${outDir}/${relativePath}`, body);
  return {
    bodyFile: relativePath,
    bodySha256: sha256(body),
    bodyBytes: body.length,
  };
}

async function emit(candidate, record) {
  const value = {
    schemaVersion: 1,
    frontierId: frontier.frontierId,
    frontierSha256: frontier.frontierSha256,
    slot,
    identityKey: candidate.identityKey,
    observedAt: new Date().toISOString(),
    ...record,
  };
  value.recordSha256 = sha256(Buffer.from(JSON.stringify(value)));
  observations.push(value);
  await appendFile(recordsPath, `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

async function fetchRawBounded(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: options.accept ?? "*/*",
        "user-agent":
          "RLF-Evidence-Audit/1.0 (+https://github.com/FIGUEBARCELONA/ready-like-freddy)",
        ...(options.headers ?? {}),
      },
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel("response byte limit exceeded");
          throw new Error(`Response exceeded ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    clearTimeout(timer);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.concat(chunks),
      error: null,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      ok: false,
      status: null,
      finalUrl: url,
      contentType: "",
      headers: {},
      body: Buffer.alloc(0),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function captureCurrentOfficialPage(candidate, requestedUrl, recordType) {
  try {
    const fetched = await fetchEvidenceSource(requestedUrl, {
      maxBytes: 8 * 1024 * 1024,
      directAttempts: 1,
      readerAttempts: 1,
      directTimeoutMs: 15_000,
      readerTimeoutMs: 25_000,
    });
    const response = fetched.response;
    const persisted = await persistBody(recordType, response.body);
    const content = response.body.toString("utf8");
    const analysis = response.ok
      ? analyzeCapturedPage(candidate, requestedUrl, content, recordType)
      : emptyAnalysis(candidate, requestedUrl);
    return emit(candidate, {
      recordType,
      requestedUrl,
      sourceTransport: fetched.sourceTransport,
      sourceFetchUrl: fetched.sourceFetchUrl,
      response: responseMetadata(response),
      originResponse: fetched.originResponse,
      fallbackError: fetched.fallbackError ?? null,
      transportAttempts: fetched.transportAttempts ?? [],
      ...persisted,
      analysis,
      transportError: null,
    });
  } catch (error) {
    return emit(candidate, {
      recordType,
      requestedUrl,
      response: null,
      analysis: emptyAnalysis(candidate, requestedUrl),
      transportError: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseWaybackRows(body) {
  try {
    const value = JSON.parse(body.toString("utf8"));
    if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
    const headers = value[0];
    return value.slice(1).map(row =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
    );
  } catch {
    return [];
  }
}

function selectBoundaryCaptures(rows) {
  const usable = rows
    .filter(row => /^\d{14}$/.test(String(row.timestamp ?? "")))
    .filter(row => isOfficialFredPerryUrl(row.original))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const byDigest = [
    ...new Map(usable.map(row => [row.digest ?? `${row.timestamp}|${row.original}`, row])).values(),
  ];
  if (byDigest.length <= 2) return byDigest;
  return [byDigest[0], byDigest.at(-1)];
}

async function probeWayback(candidate, pageUrl) {
  const cdxUrl = new URL("https://web.archive.org/cdx/search/cdx");
  cdxUrl.searchParams.set("url", pageUrl);
  cdxUrl.searchParams.set("matchType", "exact");
  cdxUrl.searchParams.set("output", "json");
  cdxUrl.searchParams.set(
    "fl",
    "timestamp,original,statuscode,mimetype,digest,length",
  );
  cdxUrl.searchParams.append("filter", "statuscode:200");
  cdxUrl.searchParams.set("collapse", "digest");
  cdxUrl.searchParams.set("limit", "10");
  const response = await fetchRawBounded(cdxUrl.href, {
    accept: "application/json,text/plain;q=0.9,*/*;q=0.1",
    maxBytes: 2 * 1024 * 1024,
  });
  const persisted = await persistBody("wayback-cdx", response.body);
  const rows = response.ok ? parseWaybackRows(response.body) : [];
  await emit(candidate, {
    recordType: "WAYBACK_CDX_EXACT_OFFICIAL_URL_QUERY",
    requestedUrl: cdxUrl.href,
    originalOfficialPageUrl: pageUrl,
    response: responseMetadata(response),
    ...persisted,
    archiveRowCount: rows.length,
    archiveRows: rows.slice(0, 10),
    transportError: response.error,
  });

  for (const row of selectBoundaryCaptures(rows)) {
    if (row.original !== pageUrl) continue;
    const snapshotUrl =
      `https://web.archive.org/web/${row.timestamp}id_/${row.original}`;
    const snapshot = await fetchRawBounded(snapshotUrl, {
      accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 20_000,
    });
    const snapshotPersisted = await persistBody(
      `wayback-${row.timestamp}`,
      snapshot.body,
    );
    const analysis = snapshot.ok
      ? analyzeCapturedPage(
          candidate,
          row.original,
          snapshot.body.toString("utf8"),
          "WAYBACK_ARCHIVED_CAPTURE_OF_OFFICIAL_PAGE",
        )
      : emptyAnalysis(candidate, row.original);
    await emit(candidate, {
      recordType: "WAYBACK_ARCHIVED_OFFICIAL_PAGE_CAPTURE",
      requestedUrl: snapshotUrl,
      originalOfficialPageUrl: row.original,
      archiveTimestamp: row.timestamp,
      archiveDigest: row.digest ?? null,
      archiveMimeType: row.mimetype ?? null,
      response: responseMetadata(snapshot),
      ...snapshotPersisted,
      analysis,
      transportError: snapshot.error,
    });
  }
}

function parseCommonCrawlRows(body) {
  const rows = [];
  for (const line of body.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // The raw response and its hash remain preserved; malformed rows are not used.
    }
  }
  return rows;
}

function extractWarcHttpPayload(body) {
  let expanded = body;
  if (expanded[0] === 0x1f && expanded[1] === 0x8b) {
    expanded = gunzipSync(expanded);
  }
  const firstSeparator = expanded.indexOf(Buffer.from("\r\n\r\n"));
  if (firstSeparator < 0) throw new Error("WARC header separator not found");
  const afterWarc = expanded.subarray(firstSeparator + 4);
  const secondSeparator = afterWarc.indexOf(Buffer.from("\r\n\r\n"));
  if (secondSeparator < 0) throw new Error("Embedded HTTP header not found");
  const httpHeader = afterWarc.subarray(0, secondSeparator).toString("latin1");
  if (!/^HTTP\/\d(?:\.\d)?\s+\d{3}\b/i.test(httpHeader)) {
    throw new Error("Embedded WARC payload is not an HTTP response");
  }
  return {
    httpHeader,
    payload: afterWarc.subarray(secondSeparator + 4),
    expandedSha256: sha256(expanded),
    expandedBytes: expanded.length,
  };
}

async function fetchCommonCrawlCapture(candidate, row, indexId) {
  if (
    !isOfficialFredPerryUrl(row.url) ||
    String(row.status) !== "200" ||
    !/html/i.test(String(row.mime ?? row.mime_detected ?? ""))
  ) {
    return false;
  }
  const offset = Number(row.offset);
  const length = Number(row.length);
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 1 ||
    length > 12 * 1024 * 1024 ||
    typeof row.filename !== "string"
  ) {
    return false;
  }
  const warcUrl = `https://data.commoncrawl.org/${row.filename}`;
  const rangeResponse = await fetchRawBounded(warcUrl, {
    headers: { range: `bytes=${offset}-${offset + length - 1}` },
    maxBytes: 14 * 1024 * 1024,
    timeoutMs: 25_000,
  });
  const warcPersisted = await persistBody("common-crawl-warc-range", rangeResponse.body);
  let payload = Buffer.alloc(0);
  let extraction = null;
  let extractionError = null;
  if (rangeResponse.ok) {
    try {
      extraction = extractWarcHttpPayload(rangeResponse.body);
      payload = extraction.payload;
    } catch (error) {
      extractionError = error instanceof Error ? error.message : String(error);
    }
  }
  const payloadPersisted = await persistBody("common-crawl-page", payload);
  const analysis = payload.length
    ? analyzeCapturedPage(
        candidate,
        row.url,
        payload.toString("utf8"),
        "COMMON_CRAWL_WARC_CAPTURE_OF_OFFICIAL_PAGE",
      )
    : emptyAnalysis(candidate, row.url);
  await emit(candidate, {
    recordType: "COMMON_CRAWL_WARC_OFFICIAL_PAGE_CAPTURE",
    requestedUrl: warcUrl,
    originalOfficialPageUrl: row.url,
    commonCrawlIndexId: indexId,
    commonCrawlTimestamp: row.timestamp ?? null,
    commonCrawlDigest: row.digest ?? null,
    commonCrawlFilename: row.filename,
    commonCrawlOffset: offset,
    commonCrawlLength: length,
    response: responseMetadata(rangeResponse),
    warcBodyFile: warcPersisted.bodyFile,
    warcBodySha256: warcPersisted.bodySha256,
    warcBodyBytes: warcPersisted.bodyBytes,
    bodyFile: payloadPersisted.bodyFile,
    bodySha256: payloadPersisted.bodySha256,
    bodyBytes: payloadPersisted.bodyBytes,
    expandedWarcSha256: extraction?.expandedSha256 ?? null,
    expandedWarcBytes: extraction?.expandedBytes ?? 0,
    embeddedHttpHeader: extraction?.httpHeader ?? null,
    extractionError,
    analysis,
    transportError: rangeResponse.error,
  });
  return payload.length > 0;
}

async function loadCommonCrawlIndexes(candidate) {
  const url = "https://index.commoncrawl.org/collinfo.json";
  const response = await fetchRawBounded(url, {
    accept: "application/json,text/plain;q=0.9,*/*;q=0.1",
    maxBytes: 2 * 1024 * 1024,
  });
  const persisted = await persistBody("common-crawl-collinfo", response.body);
  let values = [];
  if (response.ok) {
    try {
      const parsed = JSON.parse(response.body.toString("utf8"));
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      values = [];
    }
  }
  const indexes = values
    .filter(item => typeof item?.id === "string" && typeof item?.["cdx-api"] === "string")
    .slice(0, 2)
    .map(item => ({ id: item.id, cdxApi: item["cdx-api"] }));
  await emit(candidate, {
    recordType: "COMMON_CRAWL_COLLECTION_INDEX_QUERY",
    requestedUrl: url,
    response: responseMetadata(response),
    ...persisted,
    availableIndexCount: values.length,
    selectedIndexes: indexes,
    transportError: response.error,
  });
  return indexes;
}

async function probeCommonCrawl(candidate, pageUrl, indexes) {
  for (const index of indexes) {
    const queryUrl = new URL(index.cdxApi);
    queryUrl.searchParams.set("url", pageUrl);
    queryUrl.searchParams.set("output", "json");
    queryUrl.searchParams.set("matchType", "exact");
    queryUrl.searchParams.append("filter", "status:200");
    const response = await fetchRawBounded(queryUrl.href, {
      accept: "application/x-ndjson,text/plain;q=0.9,*/*;q=0.1",
      maxBytes: 3 * 1024 * 1024,
    });
    const persisted = await persistBody("common-crawl-index", response.body);
    const rows = response.ok ? parseCommonCrawlRows(response.body) : [];
    await emit(candidate, {
      recordType: "COMMON_CRAWL_EXACT_OFFICIAL_URL_QUERY",
      requestedUrl: queryUrl.href,
      originalOfficialPageUrl: pageUrl,
      commonCrawlIndexId: index.id,
      response: responseMetadata(response),
      ...persisted,
      archiveRowCount: rows.length,
      archiveRows: rows.slice(0, 10).map(row => ({
        url: row.url ?? null,
        timestamp: row.timestamp ?? null,
        status: row.status ?? null,
        mime: row.mime ?? null,
        digest: row.digest ?? null,
        filename: row.filename ?? null,
        offset: row.offset ?? null,
        length: row.length ?? null,
      })),
      transportError: response.error,
    });
    const selected = rows
      .filter(row => row.url === pageUrl)
      .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))[0];
    if (selected && (await fetchCommonCrawlCapture(candidate, selected, index.id))) {
      return;
    }
  }
}

for (const candidate of assignment.candidates) {
  const currentCaptures = [];
  for (const aliasUrl of candidate.aliasUrls) {
    currentCaptures.push(
      await captureCurrentOfficialPage(
        candidate,
        aliasUrl,
        "CURRENT_EXACT_OFFICIAL_PRODUCT_PAGE_CAPTURE",
      ),
    );
  }
  for (const probeTarget of candidate.independentlyObservedOfficialProbeUrls ?? []) {
    currentCaptures.push(
      await captureCurrentOfficialPage(
        candidate,
        probeTarget.url,
        "CURRENT_PUBLICLY_INDEXED_OFFICIAL_PROBE_PAGE_CAPTURE",
      ),
    );
  }
  for (const siteMapUrl of candidate.siteMapUrls) {
    currentCaptures.push(
      await captureCurrentOfficialPage(
        candidate,
        siteMapUrl,
        "CURRENT_VERIFIED_OFFICIAL_SITE_MAP_CAPTURE",
      ),
    );
  }

  const discoveredProductUrls = [
    ...new Set(
      currentCaptures.flatMap(item =>
        (item.analysis?.discoveredProductUrls ?? []).map(entry => entry.productUrl),
      ),
    ),
  ].sort();
  const alreadyCapturedCurrentPageSet = new Set([
    ...candidate.aliasUrls,
    ...(candidate.independentlyObservedOfficialProbeUrls ?? []).map(
      item => item.url,
    ),
  ]);
  const boundedDiscoveries = discoveredProductUrls
    .filter(url => !alreadyCapturedCurrentPageSet.has(url))
    .slice(0, 4);
  for (const productUrl of boundedDiscoveries) {
    currentCaptures.push(
      await captureCurrentOfficialPage(
        candidate,
        productUrl,
        "CURRENT_DISCOVERED_OFFICIAL_PRODUCT_PAGE_CAPTURE",
      ),
    );
  }

  const archiveTargets = [
    ...new Set([
      ...candidate.aliasUrls,
      ...(candidate.independentlyObservedOfficialProbeUrls ?? []).map(
        item => item.url,
      ),
      ...boundedDiscoveries,
    ]),
  ].slice(0, 8);
  for (const pageUrl of archiveTargets) {
    await probeWayback(candidate, pageUrl);
  }
  const commonCrawlIndexes = await loadCommonCrawlIndexes(candidate);
  for (const pageUrl of archiveTargets) {
    await probeCommonCrawl(candidate, pageUrl, commonCrawlIndexes);
  }
}

const exactMediaCandidateCount = observations.reduce(
  (sum, item) => sum + (item.analysis?.exactMediaCandidates?.length ?? 0),
  0,
);
const transitionBridgeCandidateCount = observations.reduce(
  (sum, item) => sum + (item.analysis?.transitionBridgeCandidates?.length ?? 0),
  0,
);
const summary = {
  schemaVersion: 1,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  slot,
  assignmentStatus: assignment.candidates.length
    ? "ACTIVE_IDENTITY_TRANSITION_ARCHIVE_GATE"
    : "AUDITED_IDLE_LANE",
  assignedIdentityCount: assignment.candidates.length,
  assignedIdentityKeys: assignment.candidates.map(item => item.identityKey),
  attemptedProbeCount: observations.length,
  successfulResponseCount: observations.filter(item => item.response?.ok).length,
  transportErrorCount: observations.filter(item => item.transportError).length,
  currentOfficialPageCaptureCount: observations.filter(item =>
    String(item.recordType).startsWith("CURRENT_"),
  ).length,
  waybackIndexQueryCount: observations.filter(
    item => item.recordType === "WAYBACK_CDX_EXACT_OFFICIAL_URL_QUERY",
  ).length,
  waybackArchivedPageCaptureCount: observations.filter(
    item => item.recordType === "WAYBACK_ARCHIVED_OFFICIAL_PAGE_CAPTURE",
  ).length,
  commonCrawlIndexQueryCount: observations.filter(
    item => item.recordType === "COMMON_CRAWL_EXACT_OFFICIAL_URL_QUERY",
  ).length,
  commonCrawlArchivedPageCaptureCount: observations.filter(
    item => item.recordType === "COMMON_CRAWL_WARC_OFFICIAL_PAGE_CAPTURE",
  ).length,
  discoveredOfficialProductUrlCount: new Set(
    observations.flatMap(item =>
      (item.analysis?.discoveredProductUrls ?? []).map(entry => entry.productUrl),
    ),
  ).size,
  exactMediaCandidateCount,
  transitionBridgeCandidateCount,
  rejectedIdentityMediaCount: observations.reduce(
    (sum, item) => sum + (item.analysis?.rejectedIdentityMedia?.length ?? 0),
    0,
  ),
  ledgerMutationCount: 0,
  completedAt: new Date().toISOString(),
};
if (
  assignment.candidates.length === 0 &&
  (summary.attemptedProbeCount !== 0 ||
    summary.exactMediaCandidateCount !== 0 ||
    summary.transitionBridgeCandidateCount !== 0)
) {
  throw new Error(`Audited idle lane ${slot} produced a false result`);
}
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
