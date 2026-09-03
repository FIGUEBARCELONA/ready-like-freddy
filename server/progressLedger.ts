import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface MetadataGaps {
  descriptionMissingIdentityCount?: number;
  priceMissingIdentityCount?: number;
  materialMissingIdentityCount?: number;
}

interface BaseProgress {
  sourceRunId?: string;
  frontier?: Record<string, number>;
  completed?: {
    identityCount?: number;
    productUrlCaptureCount?: number;
    identityKeys?: string[];
  };
  retry?: {
    identityCount?: number;
    identities?: Array<{ identityKey: string; [key: string]: unknown }>;
  };
  counters?: Record<string, number>;
  metadataGaps?: MetadataGaps;
  status?: string;
}

interface LedgerDelta {
  runId: string;
  qualityGatePassed?: boolean;
  completedIdentityKeys: string[];
  capturedProductUrlCount?: number;
  failedIdentities?: Array<{ identityKey: string; [key: string]: unknown }>;
  counters?: Record<string, number>;
  metadataGaps?: MetadataGaps;
  frontier?: Record<string, number>;
  status?: string;
  ledgerDeltaSha256?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, stableValue(record[key])]),
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function optionalJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return fallback;
    throw error;
  }
}

export async function loadProductProgressLedger(executionRoot: string) {
  const basePath = resolve(executionRoot, "product-progress.json");
  const deltasDir = resolve(executionRoot, "progress-deltas");
  const base = await optionalJson<BaseProgress>(basePath, {
    completed: { identityKeys: [], productUrlCaptureCount: 0 },
    retry: { identities: [] },
    counters: {},
    metadataGaps: {},
  });

  let deltaNames: string[] = [];
  try {
    deltaNames = (await readdir(deltasDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }

  const deltas: LedgerDelta[] = [];
  for (const name of deltaNames) {
    const delta = JSON.parse(
      await readFile(resolve(deltasDir, name), "utf8"),
    ) as LedgerDelta;
    if (!delta.runId || !Array.isArray(delta.completedIdentityKeys)) {
      throw new Error(`Invalid progress delta: ${name}`);
    }
    if (delta.ledgerDeltaSha256) {
      const unsigned = { ...delta };
      delete unsigned.ledgerDeltaSha256;
      const actual = sha256(JSON.stringify(stableValue(unsigned)));
      if (actual !== delta.ledgerDeltaSha256) {
        throw new Error(`Progress delta hash mismatch: ${name}`);
      }
    }
    deltas.push(delta);
  }

  const completed = new Set(base.completed?.identityKeys ?? []);
  const retry = new Map(
    (base.retry?.identities ?? []).map(item => [item.identityKey, item]),
  );
  let productUrlCaptureCount = Number(
    base.completed?.productUrlCaptureCount ?? 0,
  );
  const counters = {
    officialProductImageReferenceCount: Number(
      base.counters?.officialProductImageReferenceCount ?? 0,
    ),
    materialEvidenceCount: Number(base.counters?.materialEvidenceCount ?? 0),
    manufacturingClaimCount: Number(
      base.counters?.manufacturingClaimCount ?? 0,
    ),
    factoryVerifiedCount: 0,
    globalCanonicalProductCount: 0,
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

  for (const delta of deltas) {
    for (const identityKey of delta.completedIdentityKeys) {
      completed.add(identityKey);
      retry.delete(identityKey);
    }
    for (const item of delta.failedIdentities ?? []) {
      if (!completed.has(item.identityKey)) retry.set(item.identityKey, item);
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

  const identityKeys = Array.from(completed).sort();
  const retryIdentities = Array.from(retry.values()).sort((a, b) =>
    a.identityKey.localeCompare(b.identityKey),
  );
  const latestDelta = deltas.at(-1);
  const state = {
    sourceRunId: latestDelta?.runId ?? base.sourceRunId,
    frontier: latestDelta?.frontier ?? base.frontier,
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
    status: latestDelta?.status ?? base.status,
    deltaCount: deltas.length,
    deltaRunIds: deltas.map(delta => delta.runId),
  };
  return {
    ...state,
    progressSha256: sha256(JSON.stringify(stableValue(state))),
  };
}
