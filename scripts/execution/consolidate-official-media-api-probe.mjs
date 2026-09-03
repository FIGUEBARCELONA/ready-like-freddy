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
  args.input ?? "execution/downloaded-sequence17-media-workers",
);
const frontierPath = resolve(
  args.frontier ?? "execution/media-probe-frontier/media-probe-frontier.json",
);
const outDir = resolve(
  args.out ?? "execution/sequence17-media-consolidated",
);
const frontier = await readJson(frontierPath);
await mkdir(outDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function identityMatchesUrl(identityKey, value) {
  try {
    const [productCode, colourCode] = identityKey.split("|");
    const path = decodeURIComponent(new URL(value).pathname).toLowerCase();
    const codePattern = productCode.toLowerCase().replaceAll("-", "[-_]");
    return new RegExp(
      `${codePattern}[-_]${colourCode.toLowerCase()}(?:[-_.]|$)`,
      "i",
    ).test(path);
  } catch {
    return false;
  }
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

const files = await walk(inputRoot);
const summaries = await Promise.all(
  files.filter(path => basename(path) === "summary.json").map(readJson),
);
const expectedSlots = Array.from(
  { length: 50 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);
const slots = new Set(summaries.map(item => item.slot));
assert(
  summaries.length === 50 &&
    slots.size === 50 &&
    expectedSlots.every(slot => slots.has(slot)),
  "Sequence 17 requires 50 unique worker summaries",
);
assert(
  summaries.every(item => item.frontierSha256 === frontier.frontierSha256),
  "Sequence 17 worker frontier hash mismatch",
);
for (const summary of summaries) {
  const unsigned = { ...summary };
  delete unsigned.summarySha256;
  assert(
    sha256(Buffer.from(JSON.stringify(unsigned))) === summary.summarySha256,
    `Worker summary hash mismatch ${summary.slot}`,
  );
}
const activeSummaries = summaries.filter(
  item => item.assignmentStatus === "ACTIVE_EXACT_OFFICIAL_MEDIA_API_PROBE",
);
const idleSummaries = summaries.filter(
  item => item.assignmentStatus === "AUDITED_IDLE_LANE",
);
assert(
  activeSummaries.length === 3 && idleSummaries.length === 47,
  "Sequence 17 requires 3 active and 47 audited idle summaries",
);
assert(
  idleSummaries.every(
    item =>
      item.assignedIdentityCount === 0 &&
      item.attemptedProbeCount === 0 &&
      item.exactImageReferenceCount === 0 &&
      item.rejectedMediaCount === 0,
  ),
  "An audited idle lane produced a false result",
);

const records = [];
for (const path of files.filter(
  item => basename(item) === "probe-records.ndjson",
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
      `Probe record frontier mismatch ${path}`,
    );
    const unsigned = { ...record };
    delete unsigned.recordSha256;
    assert(
      sha256(Buffer.from(JSON.stringify(unsigned))) === record.recordSha256,
      `Probe record hash mismatch ${record.slot}/${record.storeHeader}`,
    );
    records.push(record);
  }
}
assert(
  records.length === frontier.expectedProbeRecordCount && records.length === 10,
  `Expected 10 real API probe records, received ${records.length}`,
);
const expectedIdentityKeys = frontier.candidates.map(item => item.identityKey);
assert(
  records.every(item => expectedIdentityKeys.includes(item.identityKey)),
  "Unexpected identity reached the media probe",
);
const recordsByIdentity = new Map(
  expectedIdentityKeys.map(identityKey => [identityKey, []]),
);
for (const record of records) {
  recordsByIdentity.get(record.identityKey).push(record);
}
for (const candidate of frontier.candidates) {
  const expectedCount = candidate.storeCodes.length + 1;
  assert(
    recordsByIdentity.get(candidate.identityKey).length === expectedCount,
    `Probe count mismatch ${candidate.identityKey}`,
  );
}

const exactImagesByIdentity = new Map(
  expectedIdentityKeys.map(identityKey => [identityKey, new Map()]),
);
for (const record of records) {
  for (const image of record.acceptedImages ?? []) {
    assert(
      isOfficialFredPerryUrl(image.sourceUrl) &&
        identityMatchesUrl(record.identityKey, image.sourceUrl) &&
        image.rightsStatus === "UNKNOWN" &&
        image.ingestionStatus === "NOT_INGESTED" &&
        image.hostAllowed === true,
      `Invalid accepted image evidence ${record.identityKey}`,
    );
    const byUrl = exactImagesByIdentity.get(record.identityKey);
    if (!byUrl.has(image.sourceUrl)) {
      byUrl.set(image.sourceUrl, {
        ...image,
        observedStoreHeaders: [],
        responseBodySha256: [],
      });
    }
    const consolidated = byUrl.get(image.sourceUrl);
    consolidated.observedStoreHeaders = [
      ...new Set([
        ...consolidated.observedStoreHeaders,
        record.storeHeader ?? "DEFAULT",
      ]),
    ].sort();
    consolidated.responseBodySha256 = [
      ...new Set([
        ...consolidated.responseBodySha256,
        record.responseBodySha256,
      ]),
    ].sort();
  }
}
const exactMediaEvidence = expectedIdentityKeys.map(identityKey => ({
  identityKey,
  imageReferences: [...exactImagesByIdentity.get(identityKey).values()],
}));
const recoveredCandidateIdentityKeys = exactMediaEvidence
  .filter(item => item.imageReferences.length > 0)
  .map(item => item.identityKey)
  .sort();
const unresolvedIdentityKeys = expectedIdentityKeys
  .filter(identityKey => !recoveredCandidateIdentityKeys.includes(identityKey))
  .sort();
const statusCounts = Object.fromEntries(
  [...new Set(records.map(item => String(item.finalResponse?.httpStatus ?? "NO_RESPONSE")))]
    .sort()
    .map(status => [
      status,
      records.filter(
        item => String(item.finalResponse?.httpStatus ?? "NO_RESPONSE") === status,
      ).length,
    ]),
);
const consolidatedRecordsPath = `${outDir}/probe-records.ndjson`;
const serializedRecords = `${records
  .sort(
    (a, b) =>
      a.identityKey.localeCompare(b.identityKey) ||
      String(a.storeHeader).localeCompare(String(b.storeHeader)),
  )
  .map(item => JSON.stringify(item))
  .join("\n")}\n`;
await writeFile(consolidatedRecordsPath, serializedRecords, "utf8");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: String(process.env.GITHUB_RUN_ID ?? args.runId ?? "LOCAL"),
  runAttempt: String(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
  sourceCommitSha: process.env.GITHUB_SHA ?? null,
  targetSequence: 17,
  phaseId: "EXACT_OFFICIAL_MEDIA_API_PROBE_01",
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
  attemptedProbeCount: records.length,
  httpSuccessProbeCount: records.filter(item => item.finalResponse?.ok).length,
  parsedJsonProbeCount: records.filter(item => item.parsedJson).length,
  graphqlErrorProbeCount: records.filter(item => item.graphqlErrors.length > 0).length,
  exactItemProbeCount: records.filter(item => item.exactItemCount > 0).length,
  rejectedMediaCount: records.reduce(
    (sum, item) => sum + item.rejectedMediaCount,
    0,
  ),
  exactImageReferenceCount: exactMediaEvidence.reduce(
    (sum, item) => sum + item.imageReferences.length,
    0,
  ),
  responseStatusCounts: statusCounts,
  recoveredCandidateIdentityKeys,
  unresolvedIdentityKeys,
  exactMediaEvidence,
  recordsFileSha256: sha256(Buffer.from(serializedRecords)),
  nextAction:
    recoveredCandidateIdentityKeys.length > 0
      ? "STRICT_MEDIA_EVIDENCE_AVAILABLE_REQUIRES_SEPARATE_LEDGER_RECOVERY"
      : "NO_EXACT_OFFICIAL_MEDIA_FOUND_RETRIES_RETAINED",
  factoryVerifiedCount: 0,
  globalCanonicalProductCount: 0,
  ledgerMutationCount: 0,
  passed: true,
};
report.reportSha256 = sha256(Buffer.from(JSON.stringify(report)));
await writeJson(`${outDir}/sequence17-official-media-api-probe.json`, report);
console.log(JSON.stringify(report, null, 2));
