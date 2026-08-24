import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJson, sha256 } from "./common.mjs";

async function optionalJson(path, fallback = null) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return fallback;
    throw error;
  }
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

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function verifyDelta(delta, path) {
  if (!delta?.runId || !Array.isArray(delta.completedIdentityKeys)) {
    throw new Error(`Invalid progress ledger delta: ${path}`);
  }
  if (delta.ledgerDeltaSha256) {
    const unsigned = { ...delta };
    delete unsigned.ledgerDeltaSha256;
    const actual = sha256(Buffer.from(stableJson(unsigned)));
    if (actual !== delta.ledgerDeltaSha256) {
      throw new Error(`Progress ledger delta hash mismatch in ${path}`);
    }
  }
}

export async function loadProgressLedger(options = {}) {
  const basePath = resolve(options.basePath ?? "data/execution/product-progress.json");
  const deltasDir = resolve(
    options.deltasDir ?? resolve(dirname(basePath), "progress-deltas"),
  );
  const base = await optionalJson(basePath, {
    schemaVersion: 1,
    completed: { identityKeys: [], productUrlCaptureCount: 0 },
    retry: { identities: [] },
    counters: {},
    metadataGaps: {},
  });

  let names = [];
  try {
    names = (await readdir(deltasDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }

  const deltas = [];
  for (const name of names) {
    const path = resolve(deltasDir, name);
    const delta = await readJson(path);
    verifyDelta(delta, path);
    deltas.push({ ...delta, ledgerPath: path });
  }

  const completed = new Set(base.completed?.identityKeys ?? []);
  const retryByIdentity = new Map(
    (base.retry?.identities ?? [])
      .filter(item => item?.identityKey)
      .map(item => [item.identityKey, item]),
  );
  const counters = {
    officialProductImageReferenceCount: Number(
      base.counters?.officialProductImageReferenceCount ?? 0,
    ),
    materialEvidenceCount: Number(base.counters?.materialEvidenceCount ?? 0),
    manufacturingClaimCount: Number(
      base.counters?.manufacturingClaimCount ?? 0,
    ),
    factoryVerifiedCount: Number(base.counters?.factoryVerifiedCount ?? 0),
    globalCanonicalProductCount: Number(
      base.counters?.globalCanonicalProductCount ?? 0,
    ),
  };
  const metadataGaps = {
    descriptionMissingIdentityCount: Number(
      base.metadataGaps?.descriptionMissingIdentityCount ?? 0,
    ),
    priceMissingIdentityCount: Number(
      base.metadataGaps?.priceMissingIdentityCount ?? 0,
    ),
    materialMissingIdentityCount: Number(
      base.metadataGaps?.materialMissingIdentityCount ?? 0,
    ),
  };
  let productUrlCaptureCount = Number(
    base.completed?.productUrlCaptureCount ?? 0,
  );

  for (const delta of deltas) {
    for (const identityKey of delta.completedIdentityKeys) {
      completed.add(identityKey);
      retryByIdentity.delete(identityKey);
    }
    for (const failed of delta.failedIdentities ?? []) {
      if (failed?.identityKey && !completed.has(failed.identityKey)) {
        retryByIdentity.set(failed.identityKey, failed);
      }
    }
    productUrlCaptureCount += Number(delta.capturedProductUrlCount ?? 0);
    counters.officialProductImageReferenceCount += Number(
      delta.counters?.officialProductImageReferenceCount ?? 0,
    );
    counters.materialEvidenceCount += Number(
      delta.counters?.materialEvidenceCount ?? 0,
    );
    counters.manufacturingClaimCount += Number(
      delta.counters?.manufacturingClaimCount ?? 0,
    );
    metadataGaps.descriptionMissingIdentityCount += Number(
      delta.metadataGaps?.descriptionMissingIdentityCount ?? 0,
    );
    metadataGaps.priceMissingIdentityCount += Number(
      delta.metadataGaps?.priceMissingIdentityCount ?? 0,
    );
    metadataGaps.materialMissingIdentityCount += Number(
      delta.metadataGaps?.materialMissingIdentityCount ?? 0,
    );
  }

  counters.factoryVerifiedCount = 0;
  counters.globalCanonicalProductCount = 0;
  const identityKeys = [...completed].sort();
  const retryIdentities = [...retryByIdentity.values()].sort((a, b) =>
    a.identityKey.localeCompare(b.identityKey),
  );
  const latestDelta = deltas.at(-1) ?? null;
  const state = {
    schemaVersion: 2,
    basePath,
    deltaCount: deltas.length,
    deltaRunIds: deltas.map(delta => String(delta.runId)),
    latestRunId: latestDelta?.runId ?? base.sourceRunId ?? null,
    completed: {
      identityCount: identityKeys.length,
      productUrlCaptureCount,
      identityKeys,
    },
    retry: {
      identityCount: retryIdentities.length,
      identities: retryIdentities,
    },
    counters,
    metadataGaps,
    latestFrontier: latestDelta?.frontier ?? base.frontier ?? null,
    status: latestDelta?.status ?? base.status ?? null,
  };
  state.ledgerSha256 = sha256(Buffer.from(stableJson(state)));
  return state;
}
