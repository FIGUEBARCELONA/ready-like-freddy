import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeHtmlEntities, fetchBounded, isAllowedUrl, normalizeUrl, readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const seedsPath = resolve(args.seeds ?? "data/execution/rlf-kb-official-seeds.json");
const planPath = resolve(args.plan ?? "data/execution/rlf-kb-run-plan.json");
const outDir = resolve(args.out ?? "execution/queue");
const seeds = await readJson(seedsPath);
const plan = await readJson(planPath);
if (plan.workerCount !== 50) throw new Error(`workerCount must be exactly 50, got ${plan.workerCount}`);

const observations = [];
const discovered = new Map();
for (const seed of seeds.seeds) {
  const observedAt = new Date().toISOString();
  try {
    const response = await fetchBounded(seed.url, { maxBytes: plan.maxResponseBytes });
    const html = response.body.toString("utf8");
    const sourceSha256 = sha256(response.body);
    observations.push({
      locale: seed.locale,
      requestedUrl: seed.url,
      finalUrl: response.finalUrl,
      httpStatus: response.status,
      ok: response.ok,
      contentType: response.contentType,
      bytes: response.body.length,
      sourceSha256,
      observedAt
    });
    if (!response.ok) continue;
    const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
    for (const match of html.matchAll(hrefPattern)) {
      const normalized = normalizeUrl(decodeHtmlEntities(match[1]), response.finalUrl);
      if (!normalized || !isAllowedUrl(normalized, seeds.allowedHosts)) continue;
      const url = new URL(normalized);
      if (/\.(?:jpg|jpeg|png|webp|gif|svg|css|js|ico|pdf)(?:$|\?)/i.test(url.pathname)) continue;
      if (/\/(?:account|checkout|cart|customer|privacy|terms|help|contact|returns|delivery)(?:\/|$)/i.test(url.pathname)) continue;
      if (!discovered.has(normalized)) {
        discovered.set(normalized, {
          url: normalized,
          discoveredFrom: response.finalUrl,
          seedLocale: seed.locale,
          discoveryObservedAt: observedAt
        });
      }
    }
  } catch (error) {
    observations.push({
      locale: seed.locale,
      requestedUrl: seed.url,
      ok: false,
      observedAt,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const urls = [...discovered.values()].sort((a, b) => a.url.localeCompare(b.url));
if (urls.length < plan.workerCount) {
  throw new Error(`Official discovery produced only ${urls.length} eligible URLs; at least ${plan.workerCount} are required to activate every lane factually.`);
}
const assignments = Array.from({ length: plan.workerCount }, (_, index) => ({
  slot: `F${String(index + 1).padStart(2, "0")}`,
  index,
  urls: urls.filter((_, urlIndex) => urlIndex % plan.workerCount === index)
}));
const queuePayload = {
  schemaVersion: 1,
  queueId: `RLF-OFFICIAL-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`,
  createdAt: new Date().toISOString(),
  plan,
  allowedHosts: seeds.allowedHosts,
  sourceSeedManifestSha256: sha256(Buffer.from(JSON.stringify(seeds))),
  observations,
  discoveredUrlCount: urls.length,
  assignments
};
queuePayload.queueSha256 = sha256(Buffer.from(JSON.stringify(queuePayload)));
await mkdir(outDir, { recursive: true });
await writeJson(`${outDir}/queue.json`, queuePayload);
await writeFile(`${outDir}/urls.txt`, `${urls.map(entry => entry.url).join("\n")}\n`, "utf8");
await writeJson(`${outDir}/summary.json`, {
  queueId: queuePayload.queueId,
  queueSha256: queuePayload.queueSha256,
  workerCount: plan.workerCount,
  discoveredUrlCount: urls.length,
  successfulSeeds: observations.filter(entry => entry.ok).length,
  failedSeeds: observations.filter(entry => !entry.ok).length,
  minimumUrlsPerWorker: Math.min(...assignments.map(entry => entry.urls.length)),
  maximumUrlsPerWorker: Math.max(...assignments.map(entry => entry.urls.length))
});
console.log(JSON.stringify(await readJson(`${outDir}/summary.json`), null, 2));
