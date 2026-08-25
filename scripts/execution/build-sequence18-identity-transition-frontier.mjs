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
const seedsPath = resolve(
  args.seeds ?? "data/execution/rlf-kb-official-seeds.json",
);
const outputPath = resolve(
  args.out ??
    "execution/sequence18-frontier/identity-transition-frontier.json",
);
const executionId = process.env.GITHUB_RUN_ID ?? args.runId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  typeof executionId === "string" && /^[A-Za-z0-9._-]+$/.test(executionId),
  "Sequence 18 requires a real GitHub run ID or an explicit validation run ID",
);

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

function identityMatchesProductUrl(retry, value) {
  try {
    const path = decodeURIComponent(new URL(value).pathname).toLowerCase();
    const productCode = retry.productCode.toLowerCase().replaceAll("-", "[-_]");
    return new RegExp(
      `${productCode}[-_]${retry.colourCode.toLowerCase()}(?:\\.html|[-_/?.])`,
      "i",
    ).test(path);
  } catch {
    return false;
  }
}

function productIdentityFromUrl(value) {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    const match = path.match(
      /-([a-z]{1,8}\d{3,6}[a-z]?)-([a-z0-9]{2,5})\.html$/i,
    );
    return match
      ? {
          productCode: match[1].toUpperCase(),
          colourCode: match[2].toUpperCase(),
        }
      : null;
  } catch {
    return null;
  }
}

function seedMatchesProductUrl(seed, value, allSeeds) {
  const path = new URL(value).pathname.toLowerCase();
  const prefix = String(seed.pathPrefix ?? "/").toLowerCase();
  if (prefix === "/") {
    const localized = allSeeds
      .map(item => String(item.pathPrefix ?? "/").toLowerCase())
      .filter(item => item !== "/");
    return !localized.some(item => path.startsWith(item));
  }
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(normalizedPrefix);
}

const expectedRetryIdentityKeys = [
  "HW2300|843",
  "M1588|81B",
  "M1588|84B",
];
const expectedLedgerSha256 =
  "0476d387dbfb28ea303e9f6c1c642f22a117968537c3bff8c29678c72e60a2b7";
const independentlyObservedOfficialProbeUrls = {
  "HW2300|843": [
    "https://www.fredperry.com/ae-ar/twill-cap-hw2300-843.html",
    "https://www.fredperry.com/sa-ar/accessories/twill-cap-hw2300-843.html",
  ],
  "M1588|81B": [
    "https://www.fredperry.com/eu-de/herren/t-shirts/twin-tipped-t-shirt-m1588v-81b.html",
    "https://www.fredperry.com/eu-es/camiseta-con-el-ribete-con-dos-franjas-m1588v-81b.html",
    "https://www.fredperry.com/eu-fr/homme/t-shirts/t-shirt-a-double-lisere-m1588-81b.html",
    "https://www.fredperry.com/men/t-shirts/twin-tipped-t-shirt-m1588v-81b.html",
  ],
  "M1588|84B": [
    "https://www.fredperry.com/eu-es/camiseta-con-el-ribete-con-dos-franjas-m1588v-84b.html",
    "https://www.fredperry.com/eu-fr/t-shirt-a-double-lisere-m1588-84b.html",
    "https://www.fredperry.com/eu-it/uomo/t-shirt-con-doppia-riga-m1588v-84b.html",
    "https://www.fredperry.com/men/twin-tipped-t-shirt-m1588v-84b.html",
  ],
};
const ledger = await loadProgressLedger({
  basePath: progressPath,
  deltasDir: progressDeltasDir,
});
const seedManifest = await readJson(seedsPath);
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

assert(
  ledger.ledgerSha256 === expectedLedgerSha256 ||
    canonicalRunnerLedgerSha256 === expectedLedgerSha256,
  "Sequence 18 prior ledger SHA-256 mismatch",
);
assert(
  String(ledger.latestRunId) === "32784949243" &&
    ledger.deltaCount === 11 &&
    ledger.completed.identityCount === 1357 &&
    ledger.completed.productUrlCaptureCount === 2155 &&
    ledger.retry.identityCount === 3,
  "Sequence 18 prior ledger counters mismatch",
);
assert(
  ledger.counters.officialProductImageReferenceCount === 11708 &&
    ledger.counters.materialEvidenceCount === 1748 &&
    ledger.counters.manufacturingClaimCount === 64 &&
    ledger.counters.factoryVerifiedCount === 0 &&
    ledger.counters.globalCanonicalProductCount === 0,
  "Sequence 18 protected evidence counters mismatch",
);
const retryIdentityKeys = ledger.retry.identities
  .map(item => item.identityKey)
  .sort();
assert(
  JSON.stringify(retryIdentityKeys) ===
    JSON.stringify(expectedRetryIdentityKeys),
  "Sequence 18 retry identity set mismatch",
);
assert(
  seedManifest.verificationPolicy?.officialDomainRequired === true &&
    seedManifest.verificationPolicy?.matchingOfficialProductImageRequiredForCompletion ===
      true &&
    seedManifest.verificationPolicy?.soft404MustBeRejected === true,
  "Sequence 18 official seed verification policy mismatch",
);
const verifiedSiteMapSeeds = seedManifest.seeds.filter(
  seed =>
    seed.sourceClass === "OFFICIAL_SITE_MAP" &&
    seed.verificationStatus === "VERIFIED_OFFICIAL" &&
    isOfficialFredPerryUrl(seed.url),
);
assert(verifiedSiteMapSeeds.length >= 10, "Insufficient verified site-map seeds");

const retryByKey = new Map(
  ledger.retry.identities.map(item => [item.identityKey, item]),
);
const slots = Array.from(
  { length: 50 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);
const gbSiteMap = verifiedSiteMapSeeds.find(seed => seed.pathPrefix === "/");
assert(gbSiteMap, "Missing verified GB official site map");

const candidates = expectedRetryIdentityKeys.map((identityKey, index) => {
  const retry = retryByKey.get(identityKey);
  assert(retry, `Missing retry identity ${identityKey}`);
  const aliasUrls = [
    ...new Set(
      [retry.requestedProductUrl, ...(retry.aliasUrls ?? [])].filter(Boolean),
    ),
  ].sort();
  assert(aliasUrls.length > 0, `Retry identity has no aliases ${identityKey}`);
  assert(
    aliasUrls.every(isOfficialFredPerryUrl),
    `Retry identity has a non-official alias ${identityKey}`,
  );
  assert(
    aliasUrls.every(url => identityMatchesProductUrl(retry, url)),
    `Retry alias does not match exact identity ${identityKey}`,
  );

  const matchedSeeds = verifiedSiteMapSeeds.filter(seed =>
    aliasUrls.some(url => seedMatchesProductUrl(seed, url, verifiedSiteMapSeeds)),
  );
  const siteMapUrls = [
    ...new Set([gbSiteMap.url, ...matchedSeeds.map(seed => seed.url)]),
  ].sort();
  assert(siteMapUrls.every(isOfficialFredPerryUrl), "Invalid site-map URL");

  const observedProbeUrls = independentlyObservedOfficialProbeUrls[identityKey]
    .map(url => {
      const identity = productIdentityFromUrl(url);
      assert(identity, `Observed probe URL has no product identity ${url}`);
      assert(
        isOfficialFredPerryUrl(url) &&
          identity.colourCode === retry.colourCode &&
          (identity.productCode === retry.productCode ||
            (retry.productCode === "M1588" &&
              identity.productCode === "M1588V")),
        `Observed probe URL is outside the bounded identity relation ${url}`,
      );
      return {
        url,
        productCode: identity.productCode,
        colourCode: identity.colourCode,
        probeRelation:
          identity.productCode === retry.productCode
            ? "EXACT_CODE_COLOUR_OFFICIAL_PAGE_PROBE_TARGET"
            : "ONE_TERMINAL_LETTER_CODE_VARIANT_OFFICIAL_PAGE_PROBE_TARGET",
        observationBasis:
          "PUBLICLY_INDEXED_OFFICIAL_FREDPERRY_PAGE_REVALIDATE_IN_WORKER",
        independentlyObservedAt: "2026-08-25",
        evidenceStatus: "PROBE_TARGET_NOT_ACCEPTED_EVIDENCE",
      };
    })
    .sort((a, b) => a.url.localeCompare(b.url));

  return {
    schemaVersion: 1,
    slot: slots[index],
    identityKey,
    productCode: retry.productCode,
    colourCode: retry.colourCode,
    exactSku: `${retry.productCode}-${retry.colourCode}`,
    requestedProductUrl: retry.requestedProductUrl,
    aliasUrls,
    siteMapUrls,
    independentlyObservedOfficialProbeUrls: observedProbeUrls,
    transitionProbeEnabled: retry.productCode === "M1588",
    transitionPolicy: {
      exactColourRequired: true,
      oneTerminalLetterCodeVariantOnly: true,
      sameOfficialPageCrossCodeMediaAssociationRequired: true,
      sameColourOrProductNameAloneInsufficient: true,
      automaticAliasPromotionAllowed: false,
    },
    archiveProviders: [
      "INTERNET_ARCHIVE_CDX_EXACT_OFFICIAL_URL",
      "COMMON_CRAWL_INDEX_WARC_EXACT_OFFICIAL_URL",
    ],
    evidenceScope:
      "EXACT_OFFICIAL_MEDIA_OR_EXPLICIT_SAME_PAGE_CODE_TRANSITION_GATE",
  };
});
const assignments = slots.map((slot, index) => ({
  slot,
  index,
  candidates: index < candidates.length ? [candidates[index]] : [],
  assignmentStatus:
    index < candidates.length
      ? "ACTIVE_IDENTITY_TRANSITION_ARCHIVE_GATE"
      : "AUDITED_IDLE_LANE",
}));
const selectedIdentitySha256 = sha256(
  Buffer.from(expectedRetryIdentityKeys.join("\n")),
);
const frontier = {
  schemaVersion: 1,
  frontierId: `RLF-SEQUENCE18-IDENTITY-TRANSITION-${executionId}`,
  createdAt: new Date().toISOString(),
  targetSequence: 18,
  phaseId: "IDENTITY_TRANSITION_ARCHIVE_EVIDENCE_GATE_01",
  priorRunId: "32784949243",
  priorLedgerSha256: expectedLedgerSha256,
  priorDeltaCount: 11,
  workerCount: 50,
  activeLaneCount: 3,
  auditedIdleLaneCount: 47,
  selectedIdentityCount: 3,
  selectedIdentitySha256,
  ledgerMutationAllowed: false,
  archiveEvidencePolicy: {
    originalUrlMustBeOfficialFredPerryHttps: true,
    archiveCaptureAloneNeverEstablishesCodeAlias: true,
    exactCodeColourMediaUrlRequiredForExactMediaCandidate: true,
    samePageCrossCodeMediaAssociationRequiredForTransitionCandidate: true,
    transitionCandidateRequiresSeparateRecoveryGate: true,
  },
  candidates,
  assignments,
};
assert(
  assignments.filter(item => item.candidates.length === 1).length === 3 &&
    assignments.filter(item => item.candidates.length === 0).length === 47,
  "Sequence 18 3+47 lane allocation mismatch",
);
assert(
  candidates.reduce((sum, item) => sum + item.aliasUrls.length, 0) === 8,
  "Sequence 18 exact official alias count mismatch",
);
assert(
  candidates.reduce(
    (sum, item) =>
      sum + item.independentlyObservedOfficialProbeUrls.length,
    0,
  ) === 10,
  "Sequence 18 independently observed official probe target mismatch",
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
      exactOfficialAliasCount: candidates.reduce(
        (sum, item) => sum + item.aliasUrls.length,
        0,
      ),
      verifiedSiteMapTargetCount: candidates.reduce(
        (sum, item) => sum + item.siteMapUrls.length,
        0,
      ),
      independentlyObservedOfficialProbeTargetCount: candidates.reduce(
        (sum, item) =>
          sum + item.independentlyObservedOfficialProbeUrls.length,
        0,
      ),
      selectedIdentitySha256: frontier.selectedIdentitySha256,
      priorLedgerSha256: frontier.priorLedgerSha256,
      ledgerMutationAllowed: frontier.ledgerMutationAllowed,
    },
    null,
    2,
  ),
);
