import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256 } from "./common.mjs";

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
  if (!delta?.runId || !Array.isArray(delta.attemptedSourcePages)) {
    throw new Error(`Invalid source-page delta: ${path}`);
  }
  if (delta.attemptedSourcePageCount !== delta.attemptedSourcePages.length) {
    throw new Error(`Source-page count mismatch in ${path}`);
  }
  const uniqueWithinRun = new Set(
    delta.attemptedSourcePages.map(page => page?.url).filter(Boolean),
  );
  if (uniqueWithinRun.size !== delta.uniqueSourcePageCount) {
    throw new Error(`Source-page unique count mismatch in ${path}`);
  }
  for (const page of delta.attemptedSourcePages) {
    if (!page?.url || !page.url.startsWith("https://")) {
      throw new Error(`Invalid source-page URL in ${path}`);
    }
    if (!page.sourceSha256 || !/^[a-f0-9]{64}$/.test(page.sourceSha256)) {
      throw new Error(`Invalid source-page SHA-256 for ${page.url} in ${path}`);
    }
  }
  if (delta.sourcePageDeltaSha256) {
    const unsigned = { ...delta };
    delete unsigned.sourcePageDeltaSha256;
    const actual = sha256(Buffer.from(stableJson(unsigned)));
    if (actual !== delta.sourcePageDeltaSha256) {
      throw new Error(`Source-page delta hash mismatch in ${path}`);
    }
  }
}

export async function loadSourcePageLedger(options = {}) {
  const deltasDir = resolve(
    options.deltasDir ?? "data/execution/source-page-deltas",
  );
  let names = [];
  try {
    names = (await readdir(deltasDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }

  const pageByUrl = new Map();
  const deltas = [];
  for (const name of names) {
    const path = resolve(deltasDir, name);
    const delta = await readJson(path);
    verifyDelta(delta, path);
    deltas.push({ ...delta, ledgerPath: path });
    for (const page of delta.attemptedSourcePages) {
      const previous = pageByUrl.get(page.url);
      pageByUrl.set(page.url, {
        url: page.url,
        firstRunId: previous?.firstRunId ?? delta.runId,
        latestRunId: delta.runId,
        observationCount: Number(previous?.observationCount ?? 0) + 1,
        latestSourceSha256: page.sourceSha256,
        latestObservedAt: page.observedAt ?? null,
        latestFetchOk: Boolean(page.fetchOk),
        latestSourceTransport: page.sourceTransport ?? null,
      });
    }
  }

  const pages = [...pageByUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  const attemptedUrlSet = new Set(pages.map(page => page.url));
  const ledgerPayload = {
    schemaVersion: 1,
    deltaCount: deltas.length,
    attemptedObservationCount: deltas.reduce(
      (sum, delta) => sum + delta.attemptedSourcePageCount,
      0,
    ),
    uniqueAttemptedSourcePageCount: pages.length,
    pages,
  };
  const ledgerSha256 = sha256(Buffer.from(stableJson(ledgerPayload)));

  return {
    ...ledgerPayload,
    attemptedUrlSet,
    ledgerSha256,
    deltas,
  };
}
