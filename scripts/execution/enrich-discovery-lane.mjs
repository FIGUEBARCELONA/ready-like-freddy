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
const queuePath = resolve(args.queue ?? "execution/queue/queue.json");
const workerDir = resolve(args.dir ?? `execution/workers/${slot}`);
const queue = await readJson(queuePath);
const assignment = queue.assignments.find(entry => entry.slot === slot);
if (!assignment?.laneProfile) throw new Error(`Missing lane profile for ${slot}`);
const lane = assignment.laneProfile;

function parseNdjson(value) {
  return value
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function serializeNdjson(values) {
  return values.length ? `${values.map(value => JSON.stringify(value)).join("\n")}\n` : "";
}

const recordsPath = resolve(workerDir, "records.ndjson");
const linksPath = resolve(workerDir, "product-links.ndjson");
const summaryPath = resolve(workerDir, "summary.json");
const records = parseNdjson(await readFile(recordsPath, "utf8")).map(record => ({
  ...record,
  laneVectorKey: lane.vectorKey,
  sourceMarket: lane.market,
  sourceLocale: lane.locale,
  sourceRegionGroup: lane.regionGroup,
  sourceDiscoveryScope: lane.scope,
}));
const links = parseNdjson(await readFile(linksPath, "utf8")).map(candidate => ({
  ...candidate,
  laneVectorKey: lane.vectorKey,
  sourceMarket: lane.market,
  sourceLocale: lane.locale,
  sourceRegionGroup: lane.regionGroup,
  sourceDiscoveryScope: lane.scope,
}));
const summary = await readJson(summaryPath);
const enrichedSummary = {
  ...summary,
  laneProfile: lane,
  sourceMarket: lane.market,
  sourceLocale: lane.locale,
  sourceRegionGroup: lane.regionGroup,
  sourceDiscoveryScope: lane.scope,
};
delete enrichedSummary.summarySha256;
enrichedSummary.summarySha256 = sha256(Buffer.from(JSON.stringify(enrichedSummary)));

await writeFile(recordsPath, serializeNdjson(records), "utf8");
await writeFile(linksPath, serializeNdjson(links), "utf8");
await writeJson(summaryPath, enrichedSummary);
console.log(JSON.stringify({ slot, laneProfile: lane, records: records.length, productLinks: links.length }, null, 2));
