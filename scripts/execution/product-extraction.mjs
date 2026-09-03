import { decodeHtmlEntities, isAllowedUrl, normalizeUrl, sha256, stripTags } from "./common.mjs";

const PRODUCT_PATH_PATTERN = /-([a-z]{1,5}\d{3,6}(?:-[a-z])?)-([a-z0-9]{2,5})\.html$/i;
const PRICE_PATTERN = /(?:US\$|USD\s*|\$|€|£)\s?\d{1,5}(?:[.,]\d{2})?/;
const MATERIAL_PATTERN = /\b\d{1,3}%\s+(?:(?:recycled|organic|merino|virgin)\s+)?(?:cotton|wool|polyester|polyamide|nylon|elastane|elastodiene|acrylic|viscose|lyocell|modal|linen|leather|suede|rubber|silk|cashmere|alpaca|polyurethane|acetate)\b/gi;
const MANUFACTURING_COUNTRY_PATTERN = /\b(?:Made|Manufactured)\s+in\s+(?:England|United Kingdom|UK|Portugal|Italy|China|Japan|Vietnam|Turkey|Türkiye|Romania|Bulgaria|Tunisia|Morocco|India|Bangladesh|Indonesia|Thailand|Taiwan|South Korea|Korea|Hong Kong|Macau|Spain|France|Germany|Greece|Poland|Czech Republic|Slovakia|Hungary|Moldova|Ukraine|Lithuania|Latvia|Estonia|Pakistan|Sri Lanka|Cambodia|Malaysia|Philippines|Mexico|USA|United States)\b/gi;
const COUNTRY_OF_ORIGIN_PATTERN = /\bCountry of origin\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,60})/gi;

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
      links.push({ url, text: cleanLinkText(match[2]), index: match.index ?? 0, raw: match[0] });
    }
  }
  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi)) {
    const url = normalizeUrl(decodeHtmlEntities(match[2]), baseUrl);
    if (!url) continue;
    links.push({ url, text: cleanLinkText(match[1]), index: match.index ?? 0, raw: match[0] });
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
  const match = content.slice(start, end).match(PRICE_PATTERN);
  return match ? { raw: match[0].trim(), currency: currencyFromPrice(match[0]) } : null;
}

export function isOfficialProductMedia(imageUrl, allowedHosts) {
  if (!isAllowedUrl(imageUrl, allowedHosts)) return false;
  try {
    const url = new URL(imageUrl);
    return url.pathname.toLowerCase().includes("/media/catalog/product/") && /\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function productImageMatches(imageUrl, productCode, colourCode, allowedHosts) {
  if (!isOfficialProductMedia(imageUrl, allowedHosts)) return false;
  const value = decodeURIComponent(new URL(imageUrl).pathname).toUpperCase();
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
      productImageMatches(image.sourceUrl, identity.productCode, identity.colourCode, allowedHosts),
    );
    const price = nearestPrice(content, link.index, link.raw.length) ?? current?.observedPrice ?? null;
    const candidate = {
      schemaVersion: 2,
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

function collectManufacturingClaims(content) {
  const claims = [];
  for (const pattern of [MANUFACTURING_COUNTRY_PATTERN, COUNTRY_OF_ORIGIN_PATTERN]) {
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const before = content.slice(Math.max(0, index - 1), index);
      const after = content.slice(index + match[0].length, index + match[0].length + 2);
      if (before === "[" && after === "](") continue;
      const value = stripTags(match[0]).replace(/\s+/g, " ").trim();
      if (value && !claims.includes(value)) claims.push(value);
    }
  }
  return claims.slice(0, 10);
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
  const materialSnippets = [...content.matchAll(MATERIAL_PATTERN)]
    .map(match => match[0].replace(/\s+/g, " ").trim())
    .filter((value, index, values) => values.findIndex(candidate => candidate.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 10);
  const originSnippets = collectManufacturingClaims(content);

  return {
    title: title || null,
    productCode: identity?.productCode ?? null,
    colourCode: identity?.colourCode ?? null,
    observedPrice: price ? { raw: price, currency: currencyFromPrice(price) } : null,
    description: description || null,
    materialSnippets,
    originSnippets,
    originEvidenceStatus: originSnippets.length ? "TEXTUAL_MANUFACTURING_CLAIM_NOT_FACTORY_VERIFIED" : "NO_MANUFACTURING_CLAIM_CAPTURED",
  };
}
