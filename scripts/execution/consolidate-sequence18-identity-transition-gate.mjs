import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const inputRoot = resolve(
  args.input ?? "execution/downloaded-sequence18-identity-workers",
);
const frontierPath = resolve(
  args.frontier ??
    "execution/identity-transition-frontier/identity-transition-frontier.json",
);
const outDir = resolve(
  args.out ?? "execution/sequence18-identity-consolidated",
);
const executionId = process.env.GITHUB_RUN_ID ?? args.runId;
if (
  typeof executionId !== "string" ||
  !/^[A-Za-z0-9._-]+$/.test(executionId)
) {
  throw new Error(
    "Sequence 18 requires a real GitHub run ID or an explicit validation run ID",
  );
}
const frontier = await readJson(frontierPath);
await mkdir(outDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOfficialFredPerryUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "fredperry.com" ||
        url.hostname.endsWith(".fredperry.com"))
    );
  } catch {
    return false;
  }
}

function isOfficialProductMedia(value) {
  if (!isOfficialFredPerryUrl(value)) return false;
  const path = new URL(value).pathname.toLowerCase();
  return (
    path.includes("/media/catalog/product/") &&
    /\.(?:jpe?g|png|webp|gif)$/i.test(path)
  );
}

function mediaIdentity(value, candidate) {
  if (!isOfficialProductMedia(value)) return null;
  const path = decodeURIComponent(new URL(value).pathname).toUpperCase();
  const base = escapeRegExp(candidate.productCode);
  const match = path.match(
    new RegExp(`(?:^|/)(${base}[A-Z]?)[-_]([A-Z0-9]{2,5})(?:[-_.]|$)`),
  );
  return match
    ? { productCode: match[1], colourCode: match[2] }
    : null;
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

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

assert(
  frontier.targetSequence === 18 &&
    frontier.workerCount === 50 &&
    frontier.activeLaneCount === 3 &&
    frontier.auditedIdleLaneCount === 47 &&
    frontier.selectedIdentityCount === 3 &&
    frontier.ledgerMutationAllowed === false,
  "Invalid sequence 18 frontier",
);
const expectedIdentityKeys = [
  "HW2300|843",
  "M1588|81B",
  "M1588|84B",
];
assert(
  JSON.stringify(frontier.candidates.map(item => item.identityKey).sort()) ===
    JSON.stringify(expectedIdentityKeys),
  "Sequence 18 frontier identity set mismatch",
);
const candidateByIdentity = new Map(
  frontier.candidates.map(item => [item.identityKey, item]),
);
const assignmentBySlot = new Map(
  frontier.assignments.map(item => [item.slot, item]),
);

const files = await walk(inputRoot);
const summaryFiles = files.filter(path => basename(path) === "summary.json");
const summaries = await Promise.all(summaryFiles.map(readJson));
const expectedSlots = Array.from(
  { length: 50 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);
const summarySlots = new Set(summaries.map(item => item.slot));
assert(
  summaries.length === 50 &&
    summarySlots.size === 50 &&
    expectedSlots.every(slot => summarySlots.has(slot)),
  "Sequence 18 requires 50 unique worker summaries",
);
assert(
  summaries.every(item => item.frontierSha256 === frontier.frontierSha256),
  "Sequence 18 worker frontier hash mismatch",
);
for (const summary of summaries) {
  const unsigned = { ...summary };
  delete unsigned.summarySha256;
  assert(
    sha256(Buffer.from(JSON.stringify(unsigned))) === summary.summarySha256,
    `Worker summary hash mismatch ${summary.slot}`,
  );
  const assignment = assignmentBySlot.get(summary.slot);
  assert(assignment, `Missing frontier assignment ${summary.slot}`);
  assert(
    summary.assignedIdentityCount === assignment.candidates.length &&
      JSON.stringify(summary.assignedIdentityKeys) ===
        JSON.stringify(assignment.candidates.map(item => item.identityKey)),
    `Worker identity accounting mismatch ${summary.slot}`,
  );
}
const activeSummaries = summaries.filter(
  item =>
    item.assignmentStatus === "ACTIVE_IDENTITY_TRANSITION_ARCHIVE_GATE",
);
const idleSummaries = summaries.filter(
  item => item.assignmentStatus === "AUDITED_IDLE_LANE",
);
assert(
  activeSummaries.length === 3 && idleSummaries.length === 47,
  "Sequence 18 requires 3 active and 47 audited idle summaries",
);
assert(
  activeSummaries.every(
    item => item.assignedIdentityCount === 1 && item.attemptedProbeCount > 0,
  ),
  "Every active sequence 18 lane must emit real probe observations",
);
assert(
  idleSummaries.every(
    item =>
      item.assignedIdentityCount === 0 &&
      item.attemptedProbeCount === 0 &&
      item.successfulResponseCount === 0 &&
      item.exactMediaCandidateCount === 0 &&
      item.transitionBridgeCandidateCount === 0 &&
      item.ledgerMutationCount === 0,
  ),
  "An audited idle sequence 18 lane produced a false result",
);

const observations = [];
for (const path of files.filter(
  item => basename(item) === "observations.ndjson",
)) {
  const reader = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    assert(
      record.frontierSha256 === frontier.frontierSha256,
      `Observation frontier mismatch ${path}`,
    );
    const unsigned = { ...record };
    delete unsigned.recordSha256;
    assert(
      sha256(Buffer.from(JSON.stringify(unsigned))) === record.recordSha256,
      `Observation hash mismatch ${record.slot}/${record.recordType}`,
    );
    const assignment = assignmentBySlot.get(record.slot);
    assert(
      assignment?.candidates.length === 1 &&
        assignment.candidates[0].identityKey === record.identityKey,
      `Observation escaped active assignment ${record.slot}`,
    );
    observations.push(record);
  }
}
assert(
  observations.length ===
    summaries.reduce((sum, item) => sum + item.attemptedProbeCount, 0),
  "Sequence 18 observation count does not match worker summaries",
);
assert(
  expectedIdentityKeys.every(identityKey =>
    observations.some(item => item.identityKey === identityKey),
  ),
  "Sequence 18 did not account for every retry identity",
);

const exactMediaCandidates = [];
const transitionBridgeCandidates = [];
const rejectedIdentityMedia = [];
const discoveredOfficialProductUrls = [];
for (const observation of observations) {
  const candidate = candidateByIdentity.get(observation.identityKey);
  assert(candidate, `Unknown observation identity ${observation.identityKey}`);
  for (const evidence of observation.analysis?.exactMediaCandidates ?? []) {
    const identity = mediaIdentity(evidence.mediaUrl, candidate);
    assert(
      evidence.strictCandidate === true &&
        evidence.identityKey === candidate.identityKey &&
        evidence.rightsStatus === "UNKNOWN" &&
        evidence.ingestionStatus === "NOT_INGESTED" &&
        isOfficialFredPerryUrl(evidence.sourcePageUrl) &&
        identity?.productCode === candidate.productCode &&
        identity?.colourCode === candidate.colourCode,
      `Invalid strict exact-media candidate ${candidate.identityKey}`,
    );
    exactMediaCandidates.push({
      ...evidence,
      slot: observation.slot,
      captureRecordSha256: observation.recordSha256,
      captureBodySha256: observation.bodySha256 ?? null,
    });
  }
  for (const evidence of observation.analysis?.transitionBridgeCandidates ?? []) {
    const identity = mediaIdentity(evidence.mediaUrl, candidate);
    const sourceIsBase =
      evidence.sourcePageProductCode === candidate.productCode;
    const sourceIsAdjacent = isPermittedAdjacentCode(
      candidate,
      evidence.sourcePageProductCode,
    );
    const mediaIsBase = identity?.productCode === candidate.productCode;
    const mediaIsAdjacent = isPermittedAdjacentCode(
      candidate,
      identity?.productCode,
    );
    assert(
      evidence.bridgeCandidate === true &&
        evidence.sameOfficialPageCrossCodeMediaAssociation === true &&
        evidence.sameColourOrNameAloneUsed === false &&
        evidence.automaticAliasPromotionAllowed === false &&
        evidence.sourcePageColourCode === candidate.colourCode &&
        identity?.colourCode === candidate.colourCode &&
        isOfficialFredPerryUrl(evidence.sourcePageUrl) &&
        ((sourceIsBase && mediaIsAdjacent) ||
          (sourceIsAdjacent && mediaIsBase)),
      `Invalid cross-code bridge candidate ${candidate.identityKey}`,
    );
    transitionBridgeCandidates.push({
      ...evidence,
      slot: observation.slot,
      captureRecordSha256: observation.recordSha256,
      captureBodySha256: observation.bodySha256 ?? null,
    });
  }
  for (const rejection of observation.analysis?.rejectedIdentityMedia ?? []) {
    assert(
      isOfficialProductMedia(rejection.mediaUrl) &&
        Array.isArray(rejection.rejectionReasons) &&
        rejection.rejectionReasons.length > 0,
      `Invalid rejected media record ${candidate.identityKey}`,
    );
    rejectedIdentityMedia.push({
      identityKey: candidate.identityKey,
      sourcePageUrl:
        observation.originalOfficialPageUrl ?? observation.requestedUrl,
      sourceClass: observation.recordType,
      ...rejection,
    });
  }
  for (const discovery of observation.analysis?.discoveredProductUrls ?? []) {
    assert(
      isOfficialFredPerryUrl(discovery.productUrl) &&
        discovery.colourCode === candidate.colourCode &&
        (discovery.productCode === candidate.productCode ||
          isPermittedAdjacentCode(candidate, discovery.productCode)),
      `Invalid official discovery ${candidate.identityKey}`,
    );
    discoveredOfficialProductUrls.push({
      identityKey: candidate.identityKey,
      sourceRecordType: observation.recordType,
      sourceRecordSha256: observation.recordSha256,
      ...discovery,
    });
  }
}

function uniqueBy(values, keyFor) {
  return [...new Map(values.map(value => [keyFor(value), value])).values()];
}

const uniqueExactMediaCandidates = uniqueBy(
  exactMediaCandidates,
  item => `${item.identityKey}|${item.sourcePageUrl}|${item.mediaUrl}|${item.captureBodySha256}`,
).sort(
  (a, b) =>
    a.identityKey.localeCompare(b.identityKey) ||
    a.mediaUrl.localeCompare(b.mediaUrl),
);
const uniqueTransitionBridgeCandidates = uniqueBy(
  transitionBridgeCandidates,
  item => `${item.identityKey}|${item.sourcePageUrl}|${item.mediaUrl}|${item.captureBodySha256}`,
).sort(
  (a, b) =>
    a.identityKey.localeCompare(b.identityKey) ||
    a.mediaUrl.localeCompare(b.mediaUrl),
);
const uniqueRejectedIdentityMedia = uniqueBy(
  rejectedIdentityMedia,
  item =>
    `${item.identityKey}|${item.sourcePageUrl}|${item.mediaUrl}|${item.rejectionReasons.join(",")}`,
).sort(
  (a, b) =>
    a.identityKey.localeCompare(b.identityKey) ||
    a.mediaUrl.localeCompare(b.mediaUrl),
);
const uniqueDiscoveries = uniqueBy(
  discoveredOfficialProductUrls,
  item => `${item.identityKey}|${item.productUrl}|${item.sourceRecordSha256}`,
).sort(
  (a, b) =>
    a.identityKey.localeCompare(b.identityKey) ||
    a.productUrl.localeCompare(b.productUrl),
);

const sortedObservations = observations.sort(
  (a, b) =>
    a.slot.localeCompare(b.slot) ||
    String(a.recordType).localeCompare(String(b.recordType)) ||
    String(a.requestedUrl).localeCompare(String(b.requestedUrl)) ||
    String(a.observedAt).localeCompare(String(b.observedAt)),
);
const serializedObservations = `${sortedObservations
  .map(item => JSON.stringify(item))
  .join("\n")}\n`;
await writeFile(
  `${outDir}/identity-transition-observations.ndjson`,
  serializedObservations,
  "utf8",
);

const responseStatusCounts = Object.fromEntries(
  [
    ...new Set(
      observations.map(item => String(item.response?.httpStatus ?? "NO_RESPONSE")),
    ),
  ]
    .sort()
    .map(status => [
      status,
      observations.filter(
        item => String(item.response?.httpStatus ?? "NO_RESPONSE") === status,
      ).length,
    ]),
);
const exactMediaCandidateIdentityKeys = [
  ...new Set(uniqueExactMediaCandidates.map(item => item.identityKey)),
].sort();
const transitionBridgeCandidateIdentityKeys = [
  ...new Set(uniqueTransitionBridgeCandidates.map(item => item.identityKey)),
].sort();
const evidenceCandidateIdentityKeys = [
  ...new Set([
    ...exactMediaCandidateIdentityKeys,
    ...transitionBridgeCandidateIdentityKeys,
  ]),
].sort();

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: String(executionId),
  runAttempt: String(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
  sourceCommitSha: process.env.GITHUB_SHA ?? null,
  targetSequence: 18,
  phaseId: "IDENTITY_TRANSITION_ARCHIVE_EVIDENCE_GATE_01",
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  selectedIdentitySha256: frontier.selectedIdentitySha256,
  priorRunId: frontier.priorRunId,
  priorLedgerSha256: frontier.priorLedgerSha256,
  priorDeltaCount: frontier.priorDeltaCount,
  workerCount: 50,
  activeLaneCount: 3,
  auditedIdleLaneCount: 47,
  selectedIdentityCount: 3,
  attemptedProbeCount: observations.length,
  successfulResponseCount: observations.filter(item => item.response?.ok).length,
  transportErrorCount: observations.filter(item => item.transportError).length,
  responseStatusCounts,
  currentOfficialCaptureCount: observations.filter(item =>
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
  discoveredOfficialProductUrlCount: uniqueDiscoveries.length,
  discoveredOfficialProductUrls: uniqueDiscoveries,
  exactMediaCandidateCount: uniqueExactMediaCandidates.length,
  exactMediaCandidateIdentityKeys,
  exactMediaCandidates: uniqueExactMediaCandidates,
  transitionBridgeCandidateCount: uniqueTransitionBridgeCandidates.length,
  transitionBridgeCandidateIdentityKeys,
  transitionBridgeCandidates: uniqueTransitionBridgeCandidates,
  rejectedIdentityMediaCount: uniqueRejectedIdentityMedia.length,
  rejectedIdentityMedia: uniqueRejectedIdentityMedia,
  evidenceCandidateIdentityKeys,
  unresolvedIdentityKeys: expectedIdentityKeys,
  retriesRetained: true,
  automaticAliasPromotionPerformed: false,
  sameColourOrProductNameAloneAccepted: false,
  observationsFileSha256: sha256(Buffer.from(serializedObservations)),
  nextAction:
    uniqueExactMediaCandidates.length > 0
      ? "STRICT_EXACT_MEDIA_CANDIDATE_AVAILABLE_REQUIRES_SEPARATE_RECOVERY"
      : uniqueTransitionBridgeCandidates.length > 0
        ? "SAME_PAGE_CROSS_CODE_MEDIA_BRIDGE_CANDIDATE_REQUIRES_SEPARATE_ALIAS_GATE"
        : "NO_STRICT_IDENTITY_TRANSITION_OR_ARCHIVE_MEDIA_FOUND_RETRIES_RETAINED",
  ledgerMutationCount: 0,
  factoryVerifiedCount: 0,
  globalCanonicalProductCount: 0,
  passed: true,
};
report.reportSha256 = sha256(Buffer.from(JSON.stringify(report)));
await writeJson(
  `${outDir}/sequence18-identity-transition-archive-report.json`,
  report,
);
console.log(JSON.stringify(report, null, 2));
