import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { readJson, sha256, writeJson } from "./common.mjs";
import { loadProgressLedger } from "./progress-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const progressPath = resolve(
  args.progress ?? "data/execution/product-progress.json",
);
const progressDeltasDir = resolve(
  args.progressDeltas ?? "data/execution/progress-deltas",
);
const outputPath = resolve(
  args.out ?? "execution/sequence17-frontier/media-probe-frontier.json",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

function ledgerHashWithBasePath(ledger, basePath) {
  const unsigned = { ...ledger, basePath };
  delete unsigned.ledgerSha256;
  return sha256(Buffer.from(JSON.stringify(stableValue(unsigned))));
}

function isOfficialProductUrl(value) {
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

function marketPathToStoreCode(value) {
  const firstSegment = new URL(value).pathname.split("/").filter(Boolean)[0];
  assert(
    /^[a-z]{2}(?:-[a-z]{2})?$/i.test(firstSegment ?? ""),
    `Cannot derive an observed market from ${value}`,
  );
  return firstSegment.toLowerCase().replaceAll("-", "_");
}

const expectedRetryIdentityKeys = [
  "HW2300|843",
  "M1588|81B",
  "M1588|84B",
];
const ledger = await loadProgressLedger({
  basePath: progressPath,
  deltasDir: progressDeltasDir,
});
const repositoryName = (
  process.env.GITHUB_REPOSITORY ?? "FIGUEBARCELONA/ready-like-freddy"
)
  .split("/")
  .at(-1);
const canonicalRunnerBasePath =
  `/home/runner/work/${repositoryName}/${repositoryName}/data/execution/product-progress.json`;
const canonicalRunnerLedgerSha256 = ledgerHashWithBasePath(
  ledger,
  canonicalRunnerBasePath,
);
const expectedLedgerSha256 =
  "0476d387dbfb28ea303e9f6c1c642f22a117968537c3bff8c29678c72e60a2b7";
assert(
  ledger.ledgerSha256 === expectedLedgerSha256 ||
    canonicalRunnerLedgerSha256 === expectedLedgerSha256,
  "Sequence 17 prior ledger SHA-256 mismatch",
);
assert(
  String(ledger.latestRunId) === "32784949243" &&
    ledger.deltaCount === 11 &&
    ledger.completed.identityCount === 1357 &&
    ledger.completed.productUrlCaptureCount === 2155 &&
    ledger.retry.identityCount === 3,
  "Sequence 17 prior ledger counters mismatch",
);
assert(
  ledger.counters.officialProductImageReferenceCount === 11708 &&
    ledger.counters.materialEvidenceCount === 1748 &&
    ledger.counters.manufacturingClaimCount === 64 &&
    ledger.counters.factoryVerifiedCount === 0 &&
    ledger.counters.globalCanonicalProductCount === 0,
  "Sequence 17 protected evidence counters mismatch",
);
const retryIdentityKeys = ledger.retry.identities
  .map(item => item.identityKey)
  .sort();
assert(
  JSON.stringify(retryIdentityKeys) ===
    JSON.stringify(expectedRetryIdentityKeys),
  "Sequence 17 retry identity set mismatch",
);

const retryByKey = new Map(
  ledger.retry.identities.map(item => [item.identityKey, item]),
);
const slots = Array.from(
  { length: 50 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);
const candidates = expectedRetryIdentityKeys.map((identityKey, index) => {
  const retry = retryByKey.get(identityKey);
  assert(retry, `Missing retry identity ${identityKey}`);
  const aliasUrls = [
    ...new Set(
      [retry.requestedProductUrl, ...(retry.aliasUrls ?? [])].filter(Boolean),
    ),
  ].sort();
  assert(aliasUrls.length > 0, `Retry identity has no official URLs ${identityKey}`);
  assert(
    aliasUrls.every(isOfficialProductUrl),
    `Retry identity has a non-official URL ${identityKey}`,
  );
  const storeCodes = [
    ...new Set(aliasUrls.map(marketPathToStoreCode)),
  ].sort();
  return {
    schemaVersion: 1,
    slot: slots[index],
    identityKey,
    productCode: retry.productCode,
    colourCode: retry.colourCode,
    exactSku: `${retry.productCode}-${retry.colourCode}`,
    requestedProductUrl: retry.requestedProductUrl,
    aliasUrls,
    storeCodes,
    endpointUrl: "https://www.fredperry.com/graphql",
    evidenceScope: "EXACT_OFFICIAL_SKU_MEDIA_API_PROBE",
  };
});
const assignments = slots.map((slot, index) => ({
  slot,
  index,
  probes: index < candidates.length ? [candidates[index]] : [],
}));
const selectedIdentitySha256 = sha256(
  Buffer.from(expectedRetryIdentityKeys.join("\n")),
);
const frontier = {
  schemaVersion: 1,
  frontierId: `RLF-SEQUENCE17-MEDIA-PROBE-${process.env.GITHUB_RUN_ID ?? "LOCAL"}`,
  createdAt: new Date().toISOString(),
  targetSequence: 17,
  phaseId: "EXACT_OFFICIAL_MEDIA_API_PROBE_01",
  priorRunId: "32784949243",
  priorLedgerSha256: expectedLedgerSha256,
  priorDeltaCount: 11,
  workerCount: 50,
  activeLaneCount: 3,
  auditedIdleLaneCount: 47,
  selectedIdentityCount: 3,
  expectedProbeRecordCount: candidates.reduce(
    (sum, candidate) => sum + candidate.storeCodes.length + 1,
    0,
  ),
  selectedIdentitySha256,
  candidates,
  assignments,
};
assert(frontier.expectedProbeRecordCount === 10, "Unexpected API probe count");
assert(
  assignments.filter(item => item.probes.length === 1).length === 3 &&
    assignments.filter(item => item.probes.length === 0).length === 47,
  "Sequence 17 3+47 lane allocation mismatch",
);
frontier.frontierSha256 = sha256(Buffer.from(JSON.stringify(frontier)));

await mkdir(dirname(outputPath), { recursive: true });
await writeJson(outputPath, frontier);
console.log(
  JSON.stringify(
    {
      frontierId: frontier.frontierId,
      frontierSha256: frontier.frontierSha256,
      workerCount: frontier.workerCount,
      activeLaneCount: frontier.activeLaneCount,
      auditedIdleLaneCount: frontier.auditedIdleLaneCount,
      selectedIdentityCount: frontier.selectedIdentityCount,
      expectedProbeRecordCount: frontier.expectedProbeRecordCount,
      selectedIdentitySha256: frontier.selectedIdentitySha256,
      priorLedgerSha256: frontier.priorLedgerSha256,
    },
    null,
    2,
  ),
);
