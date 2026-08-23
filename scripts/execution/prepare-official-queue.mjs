import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeHtmlEntities,
  isAllowedUrl,
  normalizeUrl,
  readJson,
  sha256,
  writeJson,
} from "./common.mjs";
import { fetchEvidenceSource } from "./source-transport.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const seedsPath = resolve(args.seeds ?? "data/execution/rlf-kb-official-seeds.json");
const planPath = resolve(args.plan ?? "data/execution/rlf-kb-run-plan.json");
const outDir = resolve(args.out ?? "execution/queue");
const seeds = await readJson(seedsPath);
const plan = await readJson(planPath);
if (plan.workerCount !== 50) {
  throw new Error(`workerCount must be exactly 50, got ${plan.workerCount}`);
}

await mkdir(outDir, { recursive: true });
const observations = [];
const discovered = new Map();
const scopeOrder = [
  "MEN_CORE",
  "WOMEN_CORE",
  "COLLABORATIONS",
  "HERITAGE",
  "ACCESSORIES_KIDS",
  "OTHER_CATALOG",
];
const localizedPrefixes = [
  "/us/",
  "/eu-es/",
  "/eu-de/",
  "/eu-fr/",
  "/eu-it/",
  "/eu-pt/",
  "/ae-en/",
  "/eg-en/",
  "/id-en/",
  "/sa-en/",
  "/au-en/",
];

function matchesMarketPath(url, seed) {
  const path = url.pathname.toLowerCase();
  const prefix = String(seed.pathPrefix ?? "/").toLowerCase();
  if (prefix === "/") {
    return !localizedPrefixes.some(candidate => path.startsWith(candidate));
  }
  return path === prefix.replace(/\/$/, "") || path.startsWith(prefix);
}

function classifyScope(rawUrl) {
  const path = new URL(rawUrl).pathname.toLowerCase();
  if (/\/(?:collaborations?|meyba|craig-green|kris-van-assche|comme-des-garcons|george-cox|curry-paxton|palace|sanders|mastermind|our-legacy)(?:\/|$)/i.test(path)) {
    return "COLLABORATIONS";
  }
  if (/\/(?:made-in-england|back-catalogue|baseline|dna|the-fred-perry-shirt|fred-perry-shirt|tennis-dna|tennis)(?:\/|$)/i.test(path)) {
    return "HERITAGE";
  }
  if (/\/(?:women|mujer|damen|femme|donna|mulher)(?:\/|$)/i.test(path)) {
    return "WOMEN_CORE";
  }
  if (/\/(?:kids?|ninos|niños|kinder|enfant|bambino|crianca|criança|accessories|accessoires|accessori|acessorios|acessórios|complementos|bags?|bolsos|taschen|sacs|borse|bolsas|shoes?|calzado|schuhe|chaussures|scarpe|sapatos|gifting)(?:\/|$)/i.test(path)) {
    return "ACCESSORIES_KIDS";
  }
  if (/\/(?:men|mens|hombre|herren|homme|uomo|homem)(?:\/|$)/i.test(path)) {
    return "MEN_CORE";
  }
  return "OTHER_CATALOG";
}

function discoveryPriority(entry) {
  const path = new URL(entry.url).pathname.toLowerCase();
  const depth = path.split("/").filter(Boolean).length;
  let score = 100 - depth * 3;
  if (/\/collaborations?\/?$/i.test(path)) score += 80;
  if (/\/(?:back-catalogue-exclusive|made-in-england-men|the-fred-perry-shirt)\/?$/i.test(path)) score += 70;
  if (/\/(?:men|mens|hombre|herren|homme|uomo|homem|women|mujer|damen|femme|donna|mulher)\/?$/i.test(path)) score += 65;
  if (/\/(?:polo|polos|poloshirts|polo-shirts)\/?$/i.test(path)) score += 60;
  if (/\/(?:new-releases|neuheiten|nouveautes|nouveautés|nuovi-arrivi|novos-lancamentos|novedades)\/?$/i.test(path)) score += 40;
  if (/\/(?:sale|rebajas|soldes|saldi)\//i.test(path)) score -= 40;
  entry.discoveryPriority = score;
  return score;
}

function isEligibleDiscoveryUrl(url) {
  const path = url.pathname.toLowerCase();
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|css|js|ico|pdf|xml)(?:$|\?)/i.test(path)) return false;
  if (/\/(?:account|checkout|cart|customer|privacy|terms|help|contact|returns|delivery|stores?|shops?|community|size-guides?)(?:\/|$)/i.test(path)) return false;
  if (/\/[a-z0-9-]+-[a-z]{1,5}\d{3,6}(?:-[a-z])?-[a-z0-9]{2,5}\.html$/i.test(path)) return false;
  if (/\/site-map\/?$/i.test(path)) return false;
  return true;
}

function registerUrl(rawUrl, metadata) {
  const normalized = normalizeUrl(rawUrl, metadata.baseUrl ?? rawUrl);
  if (!normalized || !isAllowedUrl(normalized, seeds.allowedHosts)) return false;
  const url = new URL(normalized);
  if (!matchesMarketPath(url, metadata.seed)) return false;
  if (!isEligibleDiscoveryUrl(url)) return false;
  const scope = classifyScope(normalized);
  const existing = discovered.get(normalized);
  if (existing) {
    existing.discoveredFrom = [...new Set([...existing.discoveredFrom, metadata.discoveredFrom])];
    return true;
  }
  const entry = {
    url: normalized,
    market: metadata.seed.market,
    locale: metadata.seed.locale,
    regionGroup: metadata.seed.regionGroup,
    pathPrefix: metadata.seed.pathPrefix,
    sourceClass: "OFFICIAL_CURRENT_CATALOG_CATEGORY",
    discoveryScope: scope,
    discoveredFrom: [metadata.discoveredFrom],
    discoveryObservedAt: metadata.discoveryObservedAt,
    discoveryMethod: metadata.discoveryMethod,
    sourceTransport: metadata.sourceTransport,
    sourceSeedSha256: metadata.sourceSeedSha256,
  };
  discoveryPriority(entry);
  discovered.set(normalized, entry);
  return true;
}

function extractLinkCandidates(content, isHtml) {
  const candidates = [];
  if (isHtml) {
    for (const match of content.matchAll(/\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi)) {
      candidates.push(match[1] ?? match[2]);
    }
    for (const match of content.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
      candidates.push(match[1]);
    }
  }
  for (const match of content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+[^)]*)?\)/gi)) {
    candidates.push(match[1]);
  }
  for (const match of content.matchAll(/https?:\/\/[^\s<>'")]+/gi)) {
    candidates.push(match[0]);
  }
  return candidates.map(decodeHtmlEntities);
}

for (const seed of seeds.seeds) {
  const observedAt = new Date().toISOString();
  try {
    const fetched = await fetchEvidenceSource(seed.url, { maxBytes: plan.maxResponseBytes });
    const response = fetched.response;
    const content = response.body.toString("utf8");
    const isHtml = /html/i.test(response.contentType) || /<html[\s>]/i.test(content.slice(0, 10_000));
    const sourceSha256 = sha256(response.body);
    const candidates = extractLinkCandidates(content, isHtml);
    let eligibleLinkCount = 0;
    if (response.ok) {
      for (const raw of candidates) {
        if (registerUrl(raw, {
          baseUrl: response.finalUrl || seed.url,
          discoveredFrom: response.finalUrl || seed.url,
          discoveryObservedAt: observedAt,
          discoveryMethod: isHtml ? "OFFICIAL_SITEMAP_HTML_LINK" : "TRANSFORMED_OFFICIAL_SITEMAP_LINK",
          sourceTransport: fetched.sourceTransport,
          sourceSeedSha256: sourceSha256,
          seed,
        })) {
          eligibleLinkCount += 1;
        }
      }
    }
    observations.push({
      market: seed.market,
      locale: seed.locale,
      regionGroup: seed.regionGroup,
      requestedUrl: seed.url,
      finalUrl: response.finalUrl,
      sourceTransport: fetched.sourceTransport,
      originResponse: fetched.originResponse,
      httpStatus: response.status,
      ok: response.ok,
      contentType: response.contentType,
      bytes: response.body.length,
      sourceSha256,
      observedAt,
      rawLinkCandidateCount: candidates.length,
      eligibleLinkCount,
    });
  } catch (error) {
    observations.push({
      market: seed.market,
      locale: seed.locale,
      regionGroup: seed.regionGroup,
      requestedUrl: seed.url,
      ok: false,
      observedAt,
      rawLinkCandidateCount: 0,
      eligibleLinkCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const urls = [...discovered.values()].sort((a, b) => {
  if (a.market !== b.market) return a.market.localeCompare(b.market);
  if (a.discoveryScope !== b.discoveryScope) {
    return scopeOrder.indexOf(a.discoveryScope) - scopeOrder.indexOf(b.discoveryScope);
  }
  if (a.discoveryPriority !== b.discoveryPriority) return b.discoveryPriority - a.discoveryPriority;
  return a.url.localeCompare(b.url);
});

const vectorMap = new Map();
for (const entry of urls) {
  const key = `${entry.market}|${entry.discoveryScope}`;
  const vector = vectorMap.get(key) ?? {
    vectorKey: key,
    market: entry.market,
    locale: entry.locale,
    regionGroup: entry.regionGroup,
    scope: entry.discoveryScope,
    urls: [],
  };
  vector.urls.push(entry);
  vectorMap.set(key, vector);
}
for (const vector of vectorMap.values()) {
  vector.urls.sort((a, b) => {
    if (a.discoveryPriority !== b.discoveryPriority) return b.discoveryPriority - a.discoveryPriority;
    return a.url.localeCompare(b.url);
  });
}

const seedOrder = seeds.seeds.map(seed => seed.market);
const orderedVectors = [];
for (const scope of scopeOrder) {
  for (const market of seedOrder) {
    const vector = vectorMap.get(`${market}|${scope}`);
    if (vector) orderedVectors.push(vector);
  }
}
const selectedVectors = orderedVectors.slice(0, plan.workerCount).map(vector => ({
  ...vector,
  urls: [...vector.urls],
}));
const deferredVectors = orderedVectors.slice(plan.workerCount);

while (selectedVectors.length < plan.workerCount) {
  const splittable = [...selectedVectors]
    .filter(vector => vector.urls.length > 1)
    .sort((a, b) => b.urls.length - a.urls.length)[0];
  if (!splittable) break;
  const splitAt = Math.ceil(splittable.urls.length / 2);
  const shardUrls = splittable.urls.splice(splitAt);
  selectedVectors.push({
    ...splittable,
    vectorKey: `${splittable.vectorKey}#${selectedVectors.length + 1}`,
    urls: shardUrls,
  });
}

for (const vector of deferredVectors) {
  const lane = [...selectedVectors]
    .filter(candidate => candidate.market === vector.market)
    .sort((a, b) => a.urls.length - b.urls.length)[0] ??
    [...selectedVectors].sort((a, b) => a.urls.length - b.urls.length)[0];
  if (lane) lane.urls.push(...vector.urls);
}

if (selectedVectors.length !== plan.workerCount || selectedVectors.some(vector => vector.urls.length === 0)) {
  await writeFile(`${outDir}/urls.txt`, `${urls.map(entry => entry.url).join("\n")}\n`, "utf8");
  throw new Error(
    `Unable to construct exactly ${plan.workerCount} non-empty factual lanes from ${urls.length} URLs and ${orderedVectors.length} market-scope vectors.`,
  );
}

const assignments = selectedVectors.map((vector, index) => ({
  slot: `F${String(index + 1).padStart(2, "0")}`,
  index,
  laneProfile: {
    vectorKey: vector.vectorKey,
    market: vector.market,
    locale: vector.locale,
    regionGroup: vector.regionGroup,
    scope: vector.scope,
  },
  urls: vector.urls,
}));

const marketCounts = Object.fromEntries(
  seedOrder.map(market => [market, assignments.filter(item => item.laneProfile.market === market).length]),
);
const scopeCounts = Object.fromEntries(
  scopeOrder.map(scope => [scope, assignments.filter(item => item.laneProfile.scope === scope).length]),
);
const preflight = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  workerCount: plan.workerCount,
  sourceSeedCount: seeds.seeds.length,
  eligibleUrlCount: urls.length,
  marketScopeVectorCount: orderedVectors.length,
  successfulSeeds: observations.filter(entry => entry.ok).length,
  failedSeeds: observations.filter(entry => !entry.ok).length,
  marketLaneCounts: marketCounts,
  scopeLaneCounts: scopeCounts,
  observations,
};
await writeJson(`${outDir}/preflight.json`, preflight);

const queuePayload = {
  schemaVersion: 3,
  queueId: `RLF-OFFICIAL-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`,
  createdAt: new Date().toISOString(),
  plan,
  allowedHosts: seeds.allowedHosts,
  sourceSeedManifestSha256: sha256(Buffer.from(JSON.stringify(seeds))),
  observations,
  discoveredUrlCount: urls.length,
  marketScopeVectorCount: orderedVectors.length,
  marketLaneCounts: marketCounts,
  scopeLaneCounts: scopeCounts,
  assignments,
};
queuePayload.queueSha256 = sha256(Buffer.from(JSON.stringify(queuePayload)));
await writeJson(`${outDir}/queue.json`, queuePayload);
await writeFile(`${outDir}/urls.txt`, `${urls.map(entry => entry.url).join("\n")}\n`, "utf8");
await writeJson(`${outDir}/summary.json`, {
  queueId: queuePayload.queueId,
  queueSha256: queuePayload.queueSha256,
  workerCount: plan.workerCount,
  discoveredUrlCount: urls.length,
  marketScopeVectorCount: orderedVectors.length,
  successfulSeeds: observations.filter(entry => entry.ok).length,
  failedSeeds: observations.filter(entry => !entry.ok).length,
  marketLaneCounts: marketCounts,
  scopeLaneCounts: scopeCounts,
  minimumUrlsPerWorker: Math.min(...assignments.map(entry => entry.urls.length)),
  maximumUrlsPerWorker: Math.max(...assignments.map(entry => entry.urls.length)),
});
console.log(JSON.stringify(await readJson(`${outDir}/summary.json`), null, 2));
