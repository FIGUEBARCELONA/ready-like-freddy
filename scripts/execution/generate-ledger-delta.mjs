import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";
import { loadProgressLedger } from "./progress-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const productsDir = resolve(args.products ?? "execution/products-consolidated");
const frontierPath = resolve(
  args.frontier ?? "execution/product-frontier/product-frontier.json",
);
const baseProgressPath = resolve(
  args.progress ?? "data/execution/product-progress.json",
);
const progressDeltasDir = resolve(
  args.progressDeltas ?? "data/execution/progress-deltas",
);
const outputPath = resolve(args.out ?? `${productsDir}/ledger-delta.json`);
const auditPath = resolve(
  args.audit ?? `${productsDir}/ledger-delta-audit.json`,
);

const sourceDeltaPath = resolve(productsDir, "product-progress-delta.json");
const productManifestPath = resolve(productsDir, "product-manifest.json");
const sourceDelta = await readJson(sourceDeltaPath);
const productManifest = await readJson(productManifestPath);
const frontier = await readJson(frontierPath);
const priorLedger = await loadProgressLedger({
  basePath: baseProgressPath,
  deltasDir: progressDeltasDir,
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function verifyLogicalHash(value, field, label) {
  const claimed = value?.[field];
  if (!claimed) throw new Error(`${label} does not contain ${field}`);
  const unsigned = { ...value };
  delete unsigned[field];
  const actual = sha256(Buffer.from(JSON.stringify(unsigned)));
  if (actual !== claimed) {
    throw new Error(`${label} logical hash mismatch: ${claimed} != ${actual}`);
  }
  return actual;
}

const sourceDeltaLogicalSha256 = verifyLogicalHash(
  sourceDelta,
  "deltaSha256",
  "Product progress delta",
);
const productManifestLogicalSha256 = verifyLogicalHash(
  productManifest,
  "manifestSha256",
  "Product manifest",
);
const sourceDeltaFileSha256 = sha256(await readFile(sourceDeltaPath));
const productManifestFileSha256 = sha256(await readFile(productManifestPath));
const frontierFileSha256 = sha256(await readFile(frontierPath));

if (String(sourceDelta.runId) !== String(productManifest.runId)) {
  throw new Error(
    `Run mismatch between source delta ${sourceDelta.runId} and manifest ${productManifest.runId}`,
  );
}
if (sourceDelta.frontierSha256 !== frontier.frontierSha256) {
  throw new Error("Source delta frontier SHA-256 does not match product frontier");
}
if (sourceDelta.selectedIdentitySha256 !== frontier.selectedIdentitySha256) {
  throw new Error("Source delta selected identity SHA-256 does not match product frontier");
}
if (productManifest.frontierSha256 !== frontier.frontierSha256) {
  throw new Error("Product manifest frontier SHA-256 does not match product frontier");
}
if (productManifest.progressDeltaSha256 !== sourceDelta.deltaSha256) {
  throw new Error("Product manifest does not reference the source progress delta hash");
}

const completedIdentityKeys = [...(sourceDelta.completedIdentityKeys ?? [])];
const completedIdentitySet = new Set(completedIdentityKeys);
const failedIdentities = [...(sourceDelta.failedIdentities ?? [])];
const failedIdentityKeys = failedIdentities
  .map(item => item?.identityKey)
  .filter(Boolean);
const failedIdentitySet = new Set(failedIdentityKeys);
const priorCompleted = new Set(priorLedger.completed.identityKeys);
const overlapWithPrior = completedIdentityKeys
  .filter(identityKey => priorCompleted.has(identityKey))
  .sort();
const completedAndFailedOverlap = completedIdentityKeys
  .filter(identityKey => failedIdentitySet.has(identityKey))
  .sort();

if (completedIdentitySet.size !== completedIdentityKeys.length) {
  throw new Error("Source progress delta contains duplicate completed identity keys");
}
if (failedIdentitySet.size !== failedIdentityKeys.length) {
  throw new Error("Source progress delta contains duplicate failed identity keys");
}
if (overlapWithPrior.length) {
  throw new Error(
    `Source progress delta overlaps prior completed ledger: ${overlapWithPrior.join(",")}`,
  );
}
if (completedAndFailedOverlap.length) {
  throw new Error(
    `Identities appear as both completed and failed: ${completedAndFailedOverlap.join(",")}`,
  );
}

const successfulIdentityCaptureCount = Number(
  sourceDelta.counters?.successfulIdentityCaptureCount ?? 0,
);
const failedIdentityCaptureCount = Number(
  sourceDelta.counters?.failedIdentityCaptureCount ?? 0,
);
const selectedIdentityCount = Number(frontier.selectedIdentityCount ?? 0);
const expectedProductCaptureCount = Number(
  frontier.expectedProductCaptureCount ?? selectedIdentityCount,
);

if (successfulIdentityCaptureCount !== completedIdentityKeys.length) {
  throw new Error(
    `Successful capture counter ${successfulIdentityCaptureCount} does not match ${completedIdentityKeys.length} completed keys`,
  );
}
if (failedIdentityCaptureCount !== failedIdentities.length) {
  throw new Error(
    `Failed capture counter ${failedIdentityCaptureCount} does not match ${failedIdentities.length} failed identities`,
  );
}
if (
  successfulIdentityCaptureCount + failedIdentityCaptureCount !==
  expectedProductCaptureCount
) {
  throw new Error("Successful and failed identities do not cover the selected frontier");
}
if (productManifest.totals?.successfulIdentityCaptureCount !== successfulIdentityCaptureCount) {
  throw new Error("Product manifest successful identity count mismatch");
}
if (productManifest.totals?.failedIdentityCaptureCount !== failedIdentityCaptureCount) {
  throw new Error("Product manifest failed identity count mismatch");
}
if (frontier.previouslyCompletedIdentityCount !== priorLedger.completed.identityCount) {
  throw new Error(
    `Frontier prior count ${frontier.previouslyCompletedIdentityCount} does not match ledger ${priorLedger.completed.identityCount}`,
  );
}
if (frontier.progressSha256 && frontier.progressSha256 !== priorLedger.ledgerSha256) {
  throw new Error("Frontier was not generated from the current prior ledger SHA-256");
}
if ((productManifest.totals?.rejectedImageReferenceCount ?? 0) !== 0) {
  throw new Error("Rejected image references reached the product manifest");
}

const fullStrictBatch =
  sourceDelta.qualityGatePassed === true &&
  failedIdentityCaptureCount === 0 &&
  successfulIdentityCaptureCount === expectedProductCaptureCount;
const acceptedAt = new Date().toISOString();
const ledgerDelta = {
  schemaVersion: 3,
  runId: String(sourceDelta.runId),
  acceptedAt,
  qualityGatePassed: sourceDelta.qualityGatePassed === true,
  strictQualityGatePassed: fullStrictBatch,
  acceptance: fullStrictBatch
    ? `FULL_STRICT_EVIDENCE_${successfulIdentityCaptureCount}_COMPLETE`
    : `PARTIAL_STRICT_EVIDENCE_${successfulIdentityCaptureCount}_COMPLETE_${failedIdentityCaptureCount}_RETRY`,
  sourceEvidence: {
    productManifestSha256: productManifestLogicalSha256,
    productManifestFileSha256,
    sourceProgressDeltaSha256: sourceDeltaLogicalSha256,
    sourceProgressDeltaFileSha256,
    frontierFileSha256,
  },
  frontier: {
    frontierId: frontier.frontierId,
    candidateUrlCount: Number(frontier.uniqueProductUrlCount ?? 0),
    candidateIdentityCount: Number(frontier.uniqueProductIdentityCount ?? 0),
    previouslyCompletedIdentityCount: Number(
      frontier.previouslyCompletedIdentityCount ?? 0,
    ),
    remainingIdentityCountBeforeSelection: Number(
      frontier.remainingIdentityCountBeforeSelection ?? 0,
    ),
    selectedIdentityCount,
    expectedProductCaptureCount,
    retryIdentityCount: Number(frontier.retryIdentityCount ?? 0),
    frontierSha256: frontier.frontierSha256,
    selectedIdentitySha256: frontier.selectedIdentitySha256,
    priorLedgerSha256: priorLedger.ledgerSha256,
    priorDeltaCount: priorLedger.deltaCount,
  },
  completedIdentityKeys,
  capturedProductUrlCount: Number(sourceDelta.capturedProductUrlCount ?? 0),
  failedIdentities,
  counters: {
    successfulIdentityCaptureCount,
    failedIdentityCaptureCount,
    officialProductImageReferenceCount: Number(
      sourceDelta.counters?.officialProductImageReferenceCount ?? 0,
    ),
    materialEvidenceCount: Number(
      sourceDelta.counters?.materialEvidenceCount ?? 0,
    ),
    manufacturingClaimCount: Number(
      sourceDelta.counters?.manufacturingClaimCount ?? 0,
    ),
    factoryVerifiedCount: 0,
  },
  metadataGaps: {
    descriptionMissingIdentityCount: Number(
      sourceDelta.metadataGaps?.descriptionMissingIdentityCount ?? 0,
    ),
    priceMissingIdentityCount: Number(
      sourceDelta.metadataGaps?.priceMissingIdentityCount ?? 0,
    ),
    materialMissingIdentityCount: Number(
      sourceDelta.metadataGaps?.materialMissingIdentityCount ?? 0,
    ),
  },
  status: fullStrictBatch
    ? "FULL_STRICT_BATCH_ACCEPTED_NOT_GLOBAL_CANONICAL"
    : "PARTIAL_STRICT_BATCH_ACCEPTED_WITH_RETRIES_NOT_GLOBAL_CANONICAL",
};
ledgerDelta.ledgerDeltaSha256 = sha256(
  Buffer.from(stableJson(ledgerDelta)),
);

const audit = {
  schemaVersion: 1,
  runId: ledgerDelta.runId,
  generatedAt: acceptedAt,
  passed: true,
  sourceHashes: ledgerDelta.sourceEvidence,
  priorLedger: {
    completedIdentityCount: priorLedger.completed.identityCount,
    retryIdentityCount: priorLedger.retry.identityCount,
    deltaCount: priorLedger.deltaCount,
    ledgerSha256: priorLedger.ledgerSha256,
  },
  batch: {
    selectedIdentityCount,
    expectedProductCaptureCount,
    successfulIdentityCaptureCount,
    failedIdentityCaptureCount,
    completedIdentityKeyCount: completedIdentityKeys.length,
    capturedProductUrlCount: ledgerDelta.capturedProductUrlCount,
    overlapWithPrior,
    completedAndFailedOverlap,
  },
  projectedLedger: {
    completedIdentityCount:
      priorLedger.completed.identityCount + completedIdentityKeys.length,
    retryIdentityCount:
      new Set([
        ...priorLedger.retry.identities
          .map(item => item.identityKey)
          .filter(identityKey => !completedIdentitySet.has(identityKey)),
        ...failedIdentityKeys,
      ]).size,
  },
  ledgerDeltaSha256: ledgerDelta.ledgerDeltaSha256,
};

await writeJson(outputPath, ledgerDelta);
await writeJson(auditPath, audit);
console.log(JSON.stringify(audit, null, 2));
