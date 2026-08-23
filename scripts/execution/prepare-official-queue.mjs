import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeHtmlEntities,
  fetchBounded,
  isAllowedUrl,
  normalizeUrl,
  readJson,
  sha256,
  writeJson,
} from "./common.mjs";

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

function registerUrl(rawUrl, metadata) {
  const normalized = normalizeUrl(rawUrl, metadata.baseUrl ?? rawUrl);
  if (!normalized || !isAllowedUrl(normalized, seeds.allowedHosts)) return false;
  const url = new URL(normalized);
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|css|js|ico|pdf)(?:$|\?)/i.test(url.pathname)) return false;
  if (/\/(?:account|checkout|cart|customer|privacy|terms|help|contact|returns|delivery)(?:\/|$)/i.test(url.pathname)) return false;
  if (!discovered.has(normalized)) {
    discovered.set(normalized, {
      url: normalized,
      discoveredFrom: metadata.discoveredFrom,
      seedLocale: metadata.seedLocale,
      discoveryObservedAt: metadata.discoveryObservedAt,
      discoveryMethod: metadata.discoveryMethod,
      verifiedLabel: metadata.verifiedLabel ?? null,
    });
  }
  return true;
}

for (const entry of seeds.verifiedEntryPoints ?? []) {
  registerUrl(entry.url, {
    discoveredFrom: "VERIFIED_ENTRY_POINT_MANIFEST",
    seedLocale: entry.locale,
    discoveryObservedAt: seeds.observedAt,
    discoveryMethod: "MANUALLY_VERIFIED_OFFICIAL_URL",
    verifiedLabel: entry.label,
  });
}

for (const seed of seeds.seeds) {
  const observedAt = new Date().toISOString();
  try {
    const response = await fetchBounded(seed.url, { maxBytes: plan.maxResponseBytes });
    const html = response.body.toString("utf8");
    const sourceSha256 = sha256(response.body);
    let extractedLinkCount = 0;
    const candidates = [];

    for (const match of html.matchAll(/\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi)) {
      candidates.push(match[1] ?? match[2]);
    }
    for (const match of html.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
      candidates.push(match[1]);
    }

    if (response.ok) {
      for (const raw of candidates) {
        const normalizedRaw = decodeHtmlEntities(raw);
        if (
          registerUrl(normalizedRaw, {
            baseUrl: response.finalUrl,
            discoveredFrom: response.finalUrl,
            seedLocale: seed.locale,
            discoveryObservedAt: observedAt,
            discoveryMethod: "DYNAMIC_HTML_OR_XML_LINK",
          })
        ) {
          extractedLinkCount += 1;
        }
      }
    }

    observations.push({
      locale: seed.locale,
      requestedUrl: seed.url,
      finalUrl: response.finalUrl,
      httpStatus: response.status,
      ok: response.ok,
      contentType: response.contentType,
      bytes: response.body.length,
      sourceSha256,
      observedAt,
      rawLinkCandidateCount: candidates.length,
      eligibleLinkCount: extractedLinkCount,
    });
  } catch (error) {
    observations.push({
      locale: seed.locale,
      requestedUrl: seed.url,
      ok: false,
      observedAt,
      rawLinkCandidateCount: 0,
      eligibleLinkCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const urls = [...discovered.values()].sort((a, b) => a.url.localeCompare(b.url));
const preflight = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  workerCount: plan.workerCount,
  verifiedEntryPointCount: (seeds.verifiedEntryPoints ?? []).length,
  eligibleUrlCount: urls.length,
  successfulSeeds: observations.filter(entry => entry.ok).length,
  failedSeeds: observations.filter(entry => !entry.ok).length,
  observations,
};
await writeJson(`${outDir}/preflight.json`, preflight);

if (urls.length < plan.workerCount) {
  await writeFile(`${outDir}/urls.txt`, `${urls.map(entry => entry.url).join("\n")}\n`, "utf8");
  throw new Error(
    `Official discovery produced only ${urls.length} eligible URLs; at least ${plan.workerCount} are required to activate every lane factually. See execution/queue/preflight.json.`,
  );
}

const assignments = Array.from({ length: plan.workerCount }, (_, index) => ({
  slot: `F${String(index + 1).padStart(2, "0")}`,
  index,
  urls: urls.filter((_, urlIndex) => urlIndex % plan.workerCount === index),
}));
if (assignments.some(entry => entry.urls.length === 0)) {
  throw new Error("At least one worker assignment is empty after deterministic partitioning");
}

const queuePayload = {
  schemaVersion: 2,
  queueId: `RLF-OFFICIAL-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`,
  createdAt: new Date().toISOString(),
  plan,
  allowedHosts: seeds.allowedHosts,
  sourceSeedManifestSha256: sha256(Buffer.from(JSON.stringify(seeds))),
  observations,
  discoveredUrlCount: urls.length,
  verifiedEntryPointCount: (seeds.verifiedEntryPoints ?? []).length,
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
  verifiedEntryPointCount: queuePayload.verifiedEntryPointCount,
  successfulSeeds: observations.filter(entry => entry.ok).length,
  failedSeeds: observations.filter(entry => !entry.ok).length,
  minimumUrlsPerWorker: Math.min(...assignments.map(entry => entry.urls.length)),
  maximumUrlsPerWorker: Math.max(...assignments.map(entry => entry.urls.length)),
});
console.log(JSON.stringify(await readJson(`${outDir}/summary.json`), null, 2));
