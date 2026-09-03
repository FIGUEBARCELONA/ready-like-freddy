import { resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const progressPath = resolve(args.progress ?? "data/execution/product-progress.json");
const deltaPath = resolve(args.delta ?? "execution/products-consolidated/product-progress-delta.json");
const outputPath = resolve(args.out ?? progressPath);

async function optionalJson(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const current = await optionalJson(progressPath, {
  schemaVersion: 1,
  completed: { identityKeys: [], productUrls: [] },
  retry: { identities: [] },
  counters: {},
});
const delta = await readJson(deltaPath);

const completedIdentityKeys = new Set(current.completed?.identityKeys ?? []);
const completedProductUrls = new Set(current.completed?.productUrls ?? []);
const retryByIdentity = new Map(
  (current.retry?.identities ?? []).map(item => [item.identityKey, item]),
);

for (const item of delta.successfulIdentities ?? []) {
  completedIdentityKeys.add(item.identityKey);
  for (const url of item.aliasUrls ?? [item.preferredProductUrl]) {
    if (url) completedProductUrls.add(url);
  }
  retryByIdentity.delete(item.identityKey);
}
for (const item of delta.failedIdentities ?? []) {
  if (!completedIdentityKeys.has(item.identityKey)) retryByIdentity.set(item.identityKey, item);
}

const counters = {
  officialProductImageReferenceCount:
    Number(current.counters?.officialProductImageReferenceCount ?? 0) +
    Number(delta.counters?.officialProductImageReferenceCount ?? 0),
  materialEvidenceCount:
    Number(current.counters?.materialEvidenceCount ?? 0) +
    Number(delta.counters?.materialEvidenceCount ?? 0),
  manufacturingClaimCount:
    Number(current.counters?.manufacturingClaimCount ?? 0) +
    Number(delta.counters?.manufacturingClaimCount ?? 0),
  factoryVerifiedCount: 0,
  globalCanonicalProductCount: 0,
};

const merged = {
  ...current,
  schemaVersion: 2,
  updatedAt: new Date().toISOString(),
  sourceRunId: delta.runId,
  completed: {
    identityCount: completedIdentityKeys.size,
    productUrlCaptureCount: completedProductUrls.size,
    identityKeys: [...completedIdentityKeys].sort(),
    productUrls: [...completedProductUrls].sort(),
  },
  retry: {
    identityCount: retryByIdentity.size,
    identities: [...retryByIdentity.values()].sort((a, b) =>
      a.identityKey.localeCompare(b.identityKey),
    ),
  },
  counters,
  lastDeltaSha256: delta.deltaSha256,
  status: delta.qualityGatePassed
    ? "BATCH_ACCEPTED_AS_IDENTITY_EVIDENCE_NOT_CANONICAL"
    : "PARTIAL_BATCH_ACCEPTED_AS_EVIDENCE_NOT_CANONICAL",
};
merged.progressSha256 = sha256(Buffer.from(JSON.stringify(merged)));
await writeJson(outputPath, merged);
console.log(JSON.stringify(merged, null, 2));
