import { decodeHtmlEntities, isAllowedUrl, normalizeUrl, sha256, stripTags } from "./common.mjs";

const PRODUCT_PATH_PATTERN = /-([a-z]{1,5}\d{3,6}(?:-[a-z])?)-([a-z0-9]{2,5})\.html$/i;
const PRICE_PATTERN = /(?:US\$|USD\s*|\$|€|£)\s?\d{1,5}(?:[.,]\d{2})?/;

function cleanLinkText(value) {
  return decodeHtmlEntities(stripTags(value ?? ""))
    .replace(/^Image(?::\s*)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseProductIdentityFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(PRODUCT_PATH_PATTERN);
    if (!match) return null;
    return {
      productCode: match[1].toUpperCase(),
      colourCode: match[2].toUpperCase(),
    };
  } catch {
    return null;
  }
}

export function isOfficialProductUrl(rawUrl, allowedHosts) {
  if (!isAllowedUrl(rawUrl, allowedHosts)) return false;
  try {
    const url = new URL(rawUrl);
    if (!url.pathname.toLowerCase().endsWith(".html")) return false;
    return Boolean(parseProductIdentityFromUrl(rawUrl));
  } catch {
    return false;
  }
}

export function extractLinks(content, baseUrl, isHtml) {
  const links = [];
  if (isHtml) {
    for (const match of content.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = normalizeUrl(decodeHtmlEntities(match[1]), baseUrl);
      if (!url) continue;
      links.push({
        url,
        text: cleanLinkText(match[2]),
        index: match.index ?? 0,
        raw: match[0],
      });
    }
  }

  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi)) {
    const url = normalizeUrl(decodeHtmlEntities(match[2]), baseUrl);
    if (!url) continue;
    links.push({
      url,
      text: cleanLinkText(match[1]),
      index: match.index ?? 0,
      raw: match[0],
    });
  }

  return links;
}

function currencyFromPrice(rawPrice) {
  if (!rawPrice) return null;
  if (rawPrice.includes("€")) return "EUR";
  if (rawPrice.includes("£")) return "GBP";
  if (/US\$|USD|\$/i.test(rawPrice)) return "USD";
  return null;
}

function nearestPrice(content, index, linkLength) {
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + linkLength + 360);
  const window = content.slice(start, end);
  const match = window.match(PRICE_PATTERN);
  if (!match) return null;
  return { raw: match[0].trim(), currency: currencyFromPrice(match[0]) };
}

function productImageMatches(imageUrl, productCode, colourCode) {
  const value = decodeURIComponent(imageUrl).toUpperCase();
  const codePattern = productCode.replaceAll("-", "[-_]");
  return new RegExp(`${codePattern}[-_]${colourCode}(?:[-_.]|$)`, "i").test(value);
}

export function extractProductLinkCandidates(input) {
  const {
    content,
    baseUrl,
    isHtml,
    allowedHosts,
    imageReferences,
    sourcePageUrl,
    sourceSha256,
    sourceTransport,
    observedAt,
    queueId,
    queueSha256,
    slot,
  } = input;
  const byUrl = new Map();

  for (const link of extractLinks(content, baseUrl, isHtml)) {
    if (!isOfficialProductUrl(link.url, allowedHosts)) continue;
    const identity = parseProductIdentityFromUrl(link.url);
    if (!identity) continue;
    const current = byUrl.get(link.url);
    const displayName = link.text || current?.displayName || null;
    const matchingImages = (imageReferences ?? []).filter(image =>
      productImageMatches(image.sourceUrl, identity.productCode, identity.colourCode),
    );
    const price = nearestPrice(content, link.index, link.raw.length) ?? current?.observedPrice ?? null;
    const candidate = {
      schemaVersion: 1,
      queueId,
      queueSha256,
      slot,
      candidateKey: sha256(Buffer.from(link.url)),
      productUrl: link.url,
      productCode: identity.productCode,
      colourCode: identity.colourCode,
      displayName,
      observedPrice: price,
      sourcePageUrl,
      sourcePageSha256: sourceSha256,
      sourceTransport,
      observedAt,
      imageReferences: matchingImages,
      uniquenessStatus: "URL_UNIQUE_CANDIDATE_REQUIRES_CANONICAL_REVIEW",
      evidenceStatus: "OFFICIAL_PRODUCT_LINK_EXTRACTED",
    };
    if (!current || (!current.displayName && displayName) || matchingImages.length > current.imageReferences.length) {
      byUrl.set(link.url, candidate);
    }
  }

  return [...byUrl.values()].sort((a, b) => a.productUrl.localeCompare(b.productUrl));
}

export function extractProductPageFields(content, productUrl, isHtml) {
  const identity = parseProductIdentityFromUrl(productUrl);
  const title = isHtml
    ? stripTags(content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    : (content.match(/^Title:\s*(.+)$/im)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1] ?? "").trim();
  const price = content.match(PRICE_PATTERN)?.[0]?.trim() ?? null;
  const description = isHtml
    ? stripTags(content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "")
    : (content.match(/(?:^|\n)(?:Description|Product Description):\s*([^\n]{20,1200})/i)?.[1] ?? null);
  const materialSnippets = [...content.matchAll(/\b\d{1,3}%\s+[A-Za-z][A-Za-z\s-]{1,40}/g)]
    .map(match => match[0].trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 10);
  const originSnippets = [...content.matchAll(/\b(?:Made in|Manufactured in|Country of origin[:\s]+)[^\n<]{2,100}/gi)]
    .map(match => stripTags(match[0]))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 10);

  return {
    title: title || null,
    productCode: identity?.productCode ?? null,
    colourCode: identity?.colourCode ?? null,
    observedPrice: price ? { raw: price, currency: currencyFromPrice(price) } : null,
    description: description || null,
    materialSnippets,
    originSnippets,
  };
}
