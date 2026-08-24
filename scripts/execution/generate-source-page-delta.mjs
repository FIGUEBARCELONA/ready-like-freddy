import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";
import { loadSourcePageLedger } from "./source-page-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

const recordsPath = resolve(
  args.records ?? "execution/consolidated/records.ndjson",
);
const manifestPath = resolve(
  args.manifest ?? "execution/consolidated/manifest.json",
);
const deltasDir = resolve(
  args.deltasDir ?? "data/execution/source-page-deltas",
);
const auditsDir = resolve(
  args.auditsDir ?? "data/execution/source-page-delta-audits",
);
const runId = String(args.runId ?? process.env.GITHUB_RUN_ID ?? "").trim();
const artifactId = Number(args.artifactId ?? process.env.RLF_SOURCE_ARTIFACT_ID);
const artifactDigest = String(
  args.artifactDigest ?? process.env.RLF_SOURCE_ARTIFACT_DIGEST ?? "",
).trim();
const artifactName = String(
  args.artifactName ??
    process.env.RLF_SOURCE_ARTIFACT_NAME ??
    `rlf-kb-official-discovery-${runId}`,
).trim();

if (!/^\d+$/.test(runId)) throw new Error(`Invalid run ID: ${runId}`);
if (!Number.isInteger(artifactId) || artifactId <= 0) {
  throw new Error(`Invalid discovery artifact ID: ${artifactId}`);
}
if (!/^sha256:[a-f0-9]{64}$/.test(artifactDigest)) {
  throw new Error(`Invalid discovery artifact digest: ${artifactDigest}`);
}
if (!artifactName) throw new Error("Missing discovery artifact name");

const manifest = await readJson(manifestPath);
if (String(manifest.runId) !== runId) {
  throw new Error(`Discovery manifest run mismatch: ${manifest.runId} != ${runId}`);
}
if (
  manifest.workerCount !== 50 ||
  manifest.workerSummaries?.length !== 50 ||
  !manifest.qualityGatePassed
) {
  throw new Error("Discovery manifest did not pass the factual 50-worker gate");
}

const records = (await readFile(recordsPath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));
const expectedCount = Number(manifest.totals?.attemptedUrlCount ?? -1);
if (records.length !== expectedCount || expectedCount < 1) {
  throw new Error(
    `Source-page record count mismatch: ${records.length} != ${expectedCount}`,
  );
}

const prior = await loadSourcePageLedger({ deltasDir });
const attemptedSourcePages = records.map(record => ({
  url: record.requestedUrl,
  sourceSha256: record.sourceSha256,
  slot: record.slot,
  fetchOk: Boolean(record.fetchOk),
  observedAt: record.observedAt ?? null,
  sourceTransport: record.sourceTransport ?? null,
  sourceMarket: record.sourceMarket ?? null,
  sourceScope: record.sourceDiscoveryScope ?? null,
  productLinkCandidateCount: Number(record.productLinkCandidateCount ?? 0),
}));

const uniqueUrls = new Set(attemptedSourcePages.map(page => page.url));
if (uniqueUrls.size !== attemptedSourcePages.length) {
  throw new Error("Discovery output contains duplicate attempted source pages");
}
const overlapWithPrior = attemptedSourcePages
  .map(page => page.url)
  .filter(url => prior.attemptedUrlSet.has(url));
if (overlapWithPrior.length) {
  throw new Error(`Source-page overlap with prior ledger: ${JSON.stringify(overlapWithPrior)}`);
}
for (const page of attemptedSourcePages) {
  if (!page.fetchOk) throw new Error(`Failed source page cannot enter delta: ${page.url}`);
  if (!page.url?.startsWith("https://")) throw new Error(`Invalid source URL: ${page.url}`);
  if (!/^[a-f0-9]{64}$/.test(page.sourceSha256 ?? "")) {
    throw new Error(`Invalid source SHA-256: ${page.url}`);
  }
}

const delta = {
  schemaVersion: 1,
  runId,
  acceptedAt: manifest.completedAt ?? new Date().toISOString(),
  sourceArtifact: {
    artifactId,
    artifactDigest,
    artifactName,
  },
  attemptedSourcePageCount: attemptedSourcePages.length,
  uniqueSourcePageCount: uniqueUrls.size,
  successfulSourcePageCount: attemptedSourcePages.filter(page => page.fetchOk).length,
  attemptedSourcePages,
};
delta.sourcePageDeltaSha256 = sha256(
  Buffer.from(JSON.stringify(stableValue(delta))),
);

const deltaPath = resolve(deltasDir, `${runId}.json`);
const auditPath = resolve(auditsDir, `${runId}.json`);
await mkdir(dirname(deltaPath), { recursive: true });
await mkdir(dirname(auditPath), { recursive: true });
await writeJson(deltaPath, delta);

const projected = await loadSourcePageLedger({ deltasDir });
if (projected.deltaCount !== prior.deltaCount + 1) {
  throw new Error(
    `Projected source-page delta count mismatch: ${projected.deltaCount}`,
  );
}
if (
  projected.attemptedObservationCount !==
  prior.attemptedObservationCount + attemptedSourcePages.length
) {
  throw new Error(
    `Projected observation count mismatch: ${projected.attemptedObservationCount}`,
  );
}
if (
  projected.uniqueAttemptedSourcePageCount !==
  prior.uniqueAttemptedSourcePageCount + uniqueUrls.size
) {
  throw new Error(
    `Projected unique source-page count mismatch: ${projected.uniqueAttemptedSourcePageCount}`,
  );
}

const audit = {
  schemaVersion: 1,
  runId,
  generatedAt: new Date().toISOString(),
  sourceCommitSha: process.env.GITHUB_SHA ?? null,
  sourceArtifact: delta.sourceArtifact,
  prior: {
    deltaCount: prior.deltaCount,
    attemptedObservationCount: prior.attemptedObservationCount,
    uniqueAttemptedSourcePageCount: prior.uniqueAttemptedSourcePageCount,
    ledgerSha256: prior.ledgerSha256,
  },
  batch: {
    attemptedSourcePageCount: delta.attemptedSourcePageCount,
    uniqueSourcePageCount: delta.uniqueSourcePageCount,
    successfulSourcePageCount: delta.successfulSourcePageCount,
    overlapWithPrior,
    sourcePageDeltaSha256: delta.sourcePageDeltaSha256,
  },
  projected: {
    deltaCount: projected.deltaCount,
    attemptedObservationCount: projected.attemptedObservationCount,
    uniqueAttemptedSourcePageCount: projected.uniqueAttemptedSourcePageCount,
    ledgerSha256: projected.ledgerSha256,
  },
  passed: true,
};
await writeJson(auditPath, audit);
console.log(JSON.stringify({ deltaPath, auditPath, audit }, null, 2));
