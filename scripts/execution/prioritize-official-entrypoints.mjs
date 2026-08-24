import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAllowedUrl, readJson, sha256, writeJson } from "./common.mjs";
import { loadSourcePageLedger } from "./source-page-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const seedsPath = resolve(args.seeds ?? "data/execution/rlf-kb-official-seeds.json");
const summaryPath = resolve(args.summary ?? "execution/queue/summary.json");
const urlsPath = resolve(args.urls ?? "execution/queue/urls.txt");
const queue = await readJson(queuePath);
const manifest = await readJson(seedsPath);
const entryPoints = manifest.entryPoints ?? [];
const sourcePageLedger = await loadSourcePageLedger({
  deltasDir:
    queue.plan?.discoveryPolicy?.sourcePageDeltaDirectory ??
    "data/execution/source-page-deltas",
});
const scopes = new Set([
  "MEN_CORE",
  "WOMEN_CORE",
  "COLLABORATIONS",
  "HERITAGE",
  "ACCESSORIES_KIDS",
  "OTHER_CATALOG",
]);

if (queue.workerCount && queue.workerCount !== 50) {
  throw new Error(`Expected queue workerCount 50, got ${queue.workerCount}`);
}
if (!Array.isArray(queue.assignments) || queue.assignments.length !== 50) {
  throw new Error(`Expected exactly 50 queue assignments, got ${queue.assignments?.length}`);
}

const seedByMarket = new Map(manifest.seeds.map(seed => [seed.market, seed]));
const seenEntryPointUrls = new Set();
for (const entryPoint of entryPoints) {
  if (entryPoint.verificationStatus !== "VERIFIED_OFFICIAL") {
    throw new Error(`Unverified entry point: ${entryPoint.url}`);
  }
  if (!scopes.has(entryPoint.scope)) {
    throw new Error(`Invalid entry point scope ${entryPoint.scope}: ${entryPoint.url}`);
  }
  if (!isAllowedUrl(entryPoint.url, manifest.allowedHosts)) {
    throw new Error(`Entry point is outside allowed hosts: ${entryPoint.url}`);
  }
  if (seenEntryPointUrls.has(entryPoint.url)) {
    throw new Error(`Duplicate entry point URL: ${entryPoint.url}`);
  }
  seenEntryPointUrls.add(entryPoint.url);
  const seed = seedByMarket.get(entryPoint.market);
  if (!seed) throw new Error(`Entry point market has no verified seed: ${entryPoint.market}`);
  const pathname = new URL(entryPoint.url).pathname.toLowerCase();
  const prefix = String(seed.pathPrefix ?? "/").toLowerCase();
  if (prefix === "/") {
    const localizedPrefixes = manifest.seeds
      .map(item => String(item.pathPrefix ?? "/").toLowerCase())
      .filter(item => item !== "/");
    if (localizedPrefixes.some(item => pathname.startsWith(item))) {
      throw new Error(`GB entry point uses a localized prefix: ${entryPoint.url}`);
    }
  } else if (!(pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) {
    throw new Error(`Entry point does not match market prefix ${prefix}: ${entryPoint.url}`);
  }
}

const excludedPreviouslyAttempted = [];
for (const assignment of queue.assignments) {
  const retained = [];
  for (const entry of assignment.urls) {
    if (sourcePageLedger.attemptedUrlSet.has(entry.url)) {
      excludedPreviouslyAttempted.push({
        slot: assignment.slot,
        url: entry.url,
        previousRunId:
          sourcePageLedger.pages.find(page => page.url === entry.url)?.latestRunId ?? null,
      });
    } else {
      retained.push(entry);
    }
  }
  assignment.urls = retained;
}

const unvisitedEntryPoints = entryPoints.filter(
  entryPoint => !sourcePageLedger.attemptedUrlSet.has(entryPoint.url),
);
const skippedEntryPoints = entryPoints
  .filter(entryPoint => sourcePageLedger.attemptedUrlSet.has(entryPoint.url))
  .map(entryPoint => ({
    market: entryPoint.market,
    scope: entryPoint.scope,
    url: entryPoint.url,
    reason: "PREVIOUSLY_CAPTURED_SOURCE_PAGE",
  }));

const unvisitedEntryPointUrls = new Set(unvisitedEntryPoints.map(entry => entry.url));
for (const assignment of queue.assignments) {
  assignment.urls = assignment.urls.filter(entry => !unvisitedEntryPointUrls.has(entry.url));
}

const injected = [];
for (const entryPoint of unvisitedEntryPoints) {
  const seed = seedByMarket.get(entryPoint.market);
  const candidates = queue.assignments
    .filter(
      assignment =>
        assignment.laneProfile?.market === entryPoint.market &&
        assignment.laneProfile?.scope === entryPoint.scope,
    )
    .sort((a, b) => a.urls.length - b.urls.length || a.slot.localeCompare(b.slot));
  const fallback = queue.assignments
    .filter(assignment => assignment.laneProfile?.market === entryPoint.market)
    .sort((a, b) => a.urls.length - b.urls.length || a.slot.localeCompare(b.slot));
  const target = candidates[0] ?? fallback[0];
  if (!target) throw new Error(`No factual lane available for ${entryPoint.market}`);
  const locale = entryPoint.locale ?? seed.locale;
  const injectedEntry = {
    url: entryPoint.url,
    market: entryPoint.market,
    locale,
    seedLocale: locale,
    regionGroup: entryPoint.regionGroup ?? seed.regionGroup,
    pathPrefix: seed.pathPrefix,
    sourceClass: entryPoint.sourceClass,
    discoveryScope: entryPoint.scope,
    discoveredFrom: [entryPoint.evidenceUrl ?? entryPoint.url],
    discoveryObservedAt: new Date().toISOString(),
    discoveryMethod: "VERIFIED_PRIORITY_ENTRY_POINT",
    sourceTransport: "NOT_FETCHED_QUEUE_SEED",
    sourceSeedSha256: sha256(Buffer.from(JSON.stringify(entryPoint))),
    discoveryPriority: Number(entryPoint.priority ?? 1000),
    historicalCoverageStatus: entryPoint.historicalCoverageStatus ?? "TARGETED",
  };
  target.urls.unshift(injectedEntry);
  injected.push({
    slot: target.slot,
    market: entryPoint.market,
    scope: entryPoint.scope,
    url: entryPoint.url,
    priority: injectedEntry.discoveryPriority,
  });
}

const reassignedEmptyLanes = [];
const emptyAssignments = queue.assignments
  .filter(assignment => assignment.urls.length === 0)
  .sort((a, b) => a.slot.localeCompare(b.slot));
for (const target of emptyAssignments) {
  const preferredMarket = target.laneProfile?.market ?? null;
  const preferredScope = target.laneProfile?.scope ?? null;
  const donorCandidates = queue.assignments
    .filter(assignment => assignment.slot !== target.slot && assignment.urls.length > 1)
    .map(assignment => {
      const candidate = assignment.urls.at(-1);
      return {
        assignment,
        candidate,
        marketPenalty: candidate?.market === preferredMarket ? 0 : 1,
        scopePenalty: candidate?.discoveryScope === preferredScope ? 0 : 1,
      };
    })
    .filter(item => item.candidate)
    .sort(
      (a, b) =>
        a.marketPenalty - b.marketPenalty ||
        a.scopePenalty - b.scopePenalty ||
        b.assignment.urls.length - a.assignment.urls.length ||
        a.assignment.slot.localeCompare(b.assignment.slot),
    );
  const donor = donorCandidates[0]?.assignment;
  if (!donor) break;
  const movedEntry = donor.urls.pop();
  if (!movedEntry) break;
  target.urls = [movedEntry];
  target.laneProfile = {
    vectorKey: `${movedEntry.market}|${movedEntry.discoveryScope}#ROTATION-${target.slot}`,
    market: movedEntry.market,
    locale: movedEntry.locale ?? movedEntry.seedLocale,
    regionGroup: movedEntry.regionGroup,
    scope: movedEntry.discoveryScope,
  };
  reassignedEmptyLanes.push({
    slot: target.slot,
    donorSlot: donor.slot,
    market: movedEntry.market,
    scope: movedEntry.discoveryScope,
    url: movedEntry.url,
  });
}

if (queue.assignments.some(assignment => assignment.urls.length === 0)) {
  const emptySlots = queue.assignments
    .filter(assignment => assignment.urls.length === 0)
    .map(assignment => assignment.slot);
  throw new Error(`Source-page rotation produced empty factual lanes: ${emptySlots.join(", ")}`);
}

const allEntries = queue.assignments.flatMap(assignment => assignment.urls);
const allUrls = allEntries.map(entry => entry.url);
if (new Set(allUrls).size !== allUrls.length) {
  throw new Error("Queue contains duplicate URLs after source-page rotation");
}

const policy = queue.plan?.discoveryPolicy ?? {};
if (
  Number.isInteger(policy.requiredPriorityEntryPointCount) &&
  injected.length !== policy.requiredPriorityEntryPointCount
) {
  throw new Error(
    `Injected ${injected.length}/${policy.requiredPriorityEntryPointCount} required entry points`,
  );
}
const excludedUniqueCount = new Set(
  excludedPreviouslyAttempted.map(entry => entry.url),
).size;
if (
  Number.isInteger(policy.minimumPreviouslyAttemptedSourcePageExclusions) &&
  excludedUniqueCount < policy.minimumPreviouslyAttemptedSourcePageExclusions
) {
  throw new Error(
    `Excluded ${excludedUniqueCount}/${policy.minimumPreviouslyAttemptedSourcePageExclusions} required prior source pages`,
  );
}

queue.priorityEntryPointCount = injected.length;
queue.priorityEntryPoints = injected;
queue.skippedPriorityEntryPointCount = skippedEntryPoints.length;
queue.skippedPriorityEntryPoints = skippedEntryPoints;
queue.reassignedEmptyLaneCount = reassignedEmptyLanes.length;
queue.reassignedEmptyLanes = reassignedEmptyLanes;
queue.sourcePageLedgerDeltaCount = sourcePageLedger.deltaCount;
queue.sourcePageLedgerObservationCount = sourcePageLedger.attemptedObservationCount;
queue.uniquePreviouslyAttemptedSourcePageCount =
  sourcePageLedger.uniqueAttemptedSourcePageCount;
queue.excludedPreviouslyAttemptedSourcePageCount = excludedUniqueCount;
queue.sourcePageLedgerSha256 = sourcePageLedger.ledgerSha256;
queue.discoveredUrlCount = allUrls.length;
delete queue.queueSha256;
queue.queueSha256 = sha256(Buffer.from(JSON.stringify(queue)));
await writeJson(queuePath, queue);

const priorSummary = await readJson(summaryPath);
const summary = {
  ...priorSummary,
  queueId: queue.queueId,
  queueSha256: queue.queueSha256,
  discoveredUrlCount: queue.discoveredUrlCount,
  priorityEntryPointCount: injected.length,
  priorityEntryPoints: injected,
  skippedPriorityEntryPointCount: skippedEntryPoints.length,
  skippedPriorityEntryPoints: skippedEntryPoints,
  reassignedEmptyLaneCount: reassignedEmptyLanes.length,
  reassignedEmptyLanes,
  sourcePageLedgerDeltaCount: sourcePageLedger.deltaCount,
  sourcePageLedgerObservationCount: sourcePageLedger.attemptedObservationCount,
  uniquePreviouslyAttemptedSourcePageCount:
    sourcePageLedger.uniqueAttemptedSourcePageCount,
  excludedPreviouslyAttemptedSourcePageCount: excludedUniqueCount,
  sourcePageLedgerSha256: sourcePageLedger.ledgerSha256,
  minimumUrlsPerWorker: Math.min(...queue.assignments.map(item => item.urls.length)),
  maximumUrlsPerWorker: Math.max(...queue.assignments.map(item => item.urls.length)),
};
await writeJson(summaryPath, summary);
await writeFile(urlsPath, `${allUrls.sort().join("\n")}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
