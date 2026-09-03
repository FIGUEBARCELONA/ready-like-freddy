import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) {
  throw new Error(`Invalid slot: ${slot}`);
}
const frontierPath = resolve(args.frontier ?? "execution/product-frontier/product-frontier.json");
const workerDir = resolve(args.dir ?? `execution/product-workers/${slot}`);
const frontier = await readJson(frontierPath);
const assignment = frontier.assignments.find(entry => entry.slot === slot);
if (!assignment) throw new Error(`Missing frontier assignment for ${slot}`);
const candidateByIdentity = new Map(
  assignment.products.map(candidate => [candidate.identityKey, candidate]),
);

function parseNdjson(value) {
  return value
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}
function serializeNdjson(values) {
  return values.length ? `${values.map(value => JSON.stringify(value)).join("\n")}\n` : "";
}

const recordsPath = resolve(workerDir, "product-records.ndjson");
const summaryPath = resolve(workerDir, "summary.json");
const records = parseNdjson(await readFile(recordsPath, "utf8")).map(record => {
  const candidate = candidateByIdentity.get(record.identityKey ?? `${record.productCode}|${record.colourCode}`);
  return {
    ...record,
    sourceMarkets: candidate?.sourceMarkets ?? [],
    sourceLocales: candidate?.sourceLocales ?? [],
    sourceRegionGroups: candidate?.sourceRegionGroups ?? [],
    sourceDiscoveryScopes: candidate?.sourceDiscoveryScopes ?? [],
    sourceLaneVectorKeys: candidate?.sourceLaneVectorKeys ?? [],
  };
});
const summary = await readJson(summaryPath);
const enrichedSummary = {
  ...summary,
  sourceMarkets: [...new Set(records.flatMap(record => record.sourceMarkets ?? []))].sort(),
  sourceRegionGroups: [...new Set(records.flatMap(record => record.sourceRegionGroups ?? []))].sort(),
  sourceDiscoveryScopes: [...new Set(records.flatMap(record => record.sourceDiscoveryScopes ?? []))].sort(),
};
delete enrichedSummary.summarySha256;
enrichedSummary.summarySha256 = sha256(Buffer.from(JSON.stringify(enrichedSummary)));
await writeFile(recordsPath, serializeNdjson(records), "utf8");
await writeJson(summaryPath, enrichedSummary);
console.log(JSON.stringify({
  slot,
  recordCount: records.length,
  sourceMarkets: enrichedSummary.sourceMarkets,
  sourceDiscoveryScopes: enrichedSummary.sourceDiscoveryScopes,
}, null, 2));
