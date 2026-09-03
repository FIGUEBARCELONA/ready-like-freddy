import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const dir = resolve(args.dir ?? "execution/consolidated");
const linksPath = resolve(dir, "product-link-candidates.ndjson");
const identitiesPath = resolve(dir, "product-identities.ndjson");
const frontierPath = resolve(dir, "product-frontier.json");
const manifestPath = resolve(dir, "manifest.json");

function parseNdjson(value) {
  return value
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}
function serializeNdjson(values) {
  return values.length ? `${values.map(value => JSON.stringify(value)).join("\n")}\n` : "";
}
function identityKeyOf(value) {
  return `${value.productCode}|${value.colourCode}`;
}
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

const links = parseNdjson(await readFile(linksPath, "utf8"));
const identityEvidence = new Map();
for (const link of links) {
  const key = identityKeyOf(link);
  const group = identityEvidence.get(key) ?? [];
  group.push(link);
  identityEvidence.set(key, group);
}

function enrich(identity) {
  const group = identityEvidence.get(identity.identityKey ?? identityKeyOf(identity)) ?? [];
  return {
    ...identity,
    sourceMarkets: uniqueSorted(group.map(item => item.sourceMarket)),
    sourceLocales: uniqueSorted(group.map(item => item.sourceLocale)),
    sourceRegionGroups: uniqueSorted(group.map(item => item.sourceRegionGroup)),
    sourceDiscoveryScopes: uniqueSorted(group.map(item => item.sourceDiscoveryScope)),
    sourceLaneVectorKeys: uniqueSorted(group.map(item => item.laneVectorKey)),
  };
}

const identities = parseNdjson(await readFile(identitiesPath, "utf8")).map(enrich);
const frontier = await readJson(frontierPath);
frontier.assignments = frontier.assignments.map(assignment => ({
  ...assignment,
  products: assignment.products.map(enrich),
}));
frontier.sourceMarketCounts = Object.fromEntries(
  uniqueSorted(links.map(item => item.sourceMarket)).map(market => [
    market,
    identities.filter(item => item.sourceMarkets.includes(market)).length,
  ]),
);
frontier.sourceScopeCounts = Object.fromEntries(
  uniqueSorted(links.map(item => item.sourceDiscoveryScope)).map(scope => [
    scope,
    identities.filter(item => item.sourceDiscoveryScopes.includes(scope)).length,
  ]),
);
delete frontier.frontierSha256;
frontier.frontierSha256 = sha256(Buffer.from(JSON.stringify(frontier)));

const manifest = await readJson(manifestPath);
manifest.productFrontierSha256 = frontier.frontierSha256;
manifest.sourceMarketCounts = frontier.sourceMarketCounts;
manifest.sourceScopeCounts = frontier.sourceScopeCounts;
delete manifest.manifestSha256;
manifest.manifestSha256 = sha256(Buffer.from(JSON.stringify(manifest)));

await writeFile(identitiesPath, serializeNdjson(identities), "utf8");
await writeJson(frontierPath, frontier);
await writeJson(manifestPath, manifest);
console.log(JSON.stringify({
  identityCount: identities.length,
  sourceMarketCounts: frontier.sourceMarketCounts,
  sourceScopeCounts: frontier.sourceScopeCounts,
  frontierSha256: frontier.frontierSha256,
}, null, 2));
