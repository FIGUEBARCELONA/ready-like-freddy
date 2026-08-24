import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256, sleep, writeJson } from "./common.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);
const slot = args.slot;
if (!/^F(?:0[1-9]|[1-4][0-9]|50)$/.test(slot ?? "")) {
  throw new Error(`Invalid slot ${slot}`);
}
const frontierPath = resolve(
  args.frontier ?? "execution/media-probe-frontier/media-probe-frontier.json",
);
const outDir = resolve(
  args.out ?? `execution/sequence17-media-workers/${slot}`,
);
const frontier = await readJson(frontierPath);
const assignment = frontier.assignments.find(item => item.slot === slot);
if (!assignment) throw new Error(`Missing assignment ${slot}`);
if (frontier.workerCount !== 50) {
  throw new Error(`Expected 50 workers, received ${frontier.workerCount}`);
}
await mkdir(`${outDir}/responses`, { recursive: true });
const recordsPath = `${outDir}/probe-records.ndjson`;
await writeFile(recordsPath, "", "utf8");

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

function identityMatchesUrl(identityKey, value) {
  try {
    const [productCode, colourCode] = identityKey.split("|");
    const path = decodeURIComponent(new URL(value).pathname).toLowerCase();
    const codePattern = productCode.toLowerCase().replaceAll("-", "[-_]");
    return new RegExp(
      `${codePattern}[-_]${colourCode.toLowerCase()}(?:[-_.]|$)`,
      "i",
    ).test(path);
  } catch {
    return false;
  }
}

function normalizeSku(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll("_", "-");
}

function normalizeMediaUrl(value) {
  try {
    return new URL(value, "https://www.fredperry.com/").href;
  } catch {
    return null;
  }
}

function compactGraphqlErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 20).map(error => ({
    message: String(error?.message ?? "").slice(0, 2_000),
    path: Array.isArray(error?.path) ? error.path : null,
    category:
      typeof error?.extensions?.category === "string"
        ? error.extensions.category
        : null,
  }));
}

const query = `query RlfExactProductMedia($sku: String!) {
  products(filter: { sku: { eq: $sku } }) {
    items {
      sku
      name
      media_gallery {
        url
        label
        position
        disabled
      }
    }
  }
}`;

async function fetchProbe(candidate, storeCode, probeIndex) {
  const requestBody = JSON.stringify({
    query,
    variables: { sku: candidate.exactSku },
  });
  const requestBodySha256 = sha256(Buffer.from(requestBody));
  const responseAttempts = [];
  let finalResponse = null;
  let finalBody = Buffer.alloc(0);
  let transportError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const headers = {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent":
          "RLF-Evidence-Audit/1.0 (+https://github.com/FIGUEBARCELONA/ready-like-freddy)",
      };
      if (storeCode) headers.store = storeCode;
      const response = await fetch(candidate.endpointUrl, {
        method: "POST",
        headers,
        body: requestBody,
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 10 * 1024 * 1024) {
        throw new Error(`Official API response exceeded 10 MiB: ${body.length}`);
      }
      const responseMeta = {
        attempt,
        httpStatus: response.status,
        ok: response.ok,
        finalUrl: response.url,
        contentType: response.headers.get("content-type"),
        sourceBytes: body.length,
        sourceSha256: sha256(body),
      };
      responseAttempts.push(responseMeta);
      finalResponse = responseMeta;
      finalBody = body;
      if (response.status < 500) break;
    } catch (error) {
      transportError = error instanceof Error ? error.message : String(error);
      responseAttempts.push({ attempt, transportError });
    }
    await sleep(attempt * 1_000);
  }

  const suffix = storeCode ?? "default";
  const bodyFile = `responses/${String(probeIndex).padStart(2, "0")}-${suffix}.body`;
  const metaFile = `responses/${String(probeIndex).padStart(2, "0")}-${suffix}.json`;
  await writeFile(`${outDir}/${bodyFile}`, finalBody);
  let parsed = null;
  let parseError = null;
  if (finalBody.length) {
    try {
      parsed = JSON.parse(finalBody.toString("utf8"));
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const items = Array.isArray(parsed?.data?.products?.items)
    ? parsed.data.products.items
    : [];
  const parsedJson = parsed !== null && typeof parsed === "object";
  const graphqlErrors = compactGraphqlErrors(parsed?.errors);
  const acceptedImagesByUrl = new Map();
  const rejectedMedia = [];
  const exactItems = [];
  for (const item of items) {
    const itemSku = normalizeSku(item?.sku);
    const exactSkuMatch = itemSku === normalizeSku(candidate.exactSku);
    if (exactSkuMatch) {
      exactItems.push({ sku: item.sku, name: item.name ?? null });
    }
    for (const media of item?.media_gallery ?? []) {
      const sourceUrl = normalizeMediaUrl(media?.url);
      const rejectionReasons = [];
      if (!finalResponse?.ok) rejectionReasons.push("HTTP_RESPONSE_NOT_OK");
      if (!parsedJson) rejectionReasons.push("RESPONSE_NOT_JSON");
      if (graphqlErrors.length) rejectionReasons.push("GRAPHQL_ERRORS_PRESENT");
      if (!exactSkuMatch) rejectionReasons.push("API_ITEM_SKU_MISMATCH");
      if (!sourceUrl || !isOfficialFredPerryUrl(sourceUrl)) {
        rejectionReasons.push("NON_OFFICIAL_MEDIA_URL");
      }
      if (sourceUrl && !identityMatchesUrl(candidate.identityKey, sourceUrl)) {
        rejectionReasons.push("MEDIA_URL_IDENTITY_MISMATCH");
      }
      if (media?.disabled === true) rejectionReasons.push("MEDIA_DISABLED");
      if (rejectionReasons.length) {
        rejectedMedia.push({
          itemSku: item?.sku ?? null,
          sourceUrl,
          label: media?.label ?? null,
          position: media?.position ?? null,
          disabled: media?.disabled ?? null,
          rejectionReasons,
        });
        continue;
      }
      acceptedImagesByUrl.set(sourceUrl, {
        sourceUrl,
        label: media?.label ?? null,
        position: media?.position ?? null,
        disabled: media?.disabled ?? null,
        rightsStatus: "UNKNOWN",
        ingestionStatus: "NOT_INGESTED",
        hostAllowed: true,
        evidenceSource: "OFFICIAL_GRAPHQL_EXACT_SKU_MEDIA_GALLERY",
      });
    }
  }
  const acceptedImages = [...acceptedImagesByUrl.values()];
  const record = {
    schemaVersion: 1,
    frontierId: frontier.frontierId,
    frontierSha256: frontier.frontierSha256,
    slot,
    identityKey: candidate.identityKey,
    exactSku: candidate.exactSku,
    endpointUrl: candidate.endpointUrl,
    storeHeader: storeCode,
    requestBodySha256,
    responseAttempts,
    finalResponse,
    responseBodyFile: bodyFile,
    responseBodySha256: finalResponse?.sourceSha256 ?? sha256(finalBody),
    transportError,
    parseError,
    parsedJson,
    graphqlErrors,
    returnedItemCount: items.length,
    exactItemCount: exactItems.length,
    exactItems,
    acceptedImageCount: acceptedImages.length,
    acceptedImages,
    rejectedMediaCount: rejectedMedia.length,
    rejectedMedia,
    observedAt: new Date().toISOString(),
  };
  record.recordSha256 = sha256(Buffer.from(JSON.stringify(record)));
  await writeJson(`${outDir}/${metaFile}`, record);
  return record;
}

const records = [];
for (const candidate of assignment.probes) {
  const stores = [null, ...candidate.storeCodes];
  for (let index = 0; index < stores.length; index += 1) {
    const record = await fetchProbe(candidate, stores[index], index + 1);
    records.push(record);
    await appendFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

const summary = {
  schemaVersion: 1,
  frontierId: frontier.frontierId,
  frontierSha256: frontier.frontierSha256,
  slot,
  assignmentStatus: assignment.probes.length
    ? "ACTIVE_EXACT_OFFICIAL_MEDIA_API_PROBE"
    : "AUDITED_IDLE_LANE",
  assignedIdentityCount: assignment.probes.length,
  assignedIdentityKeys: assignment.probes.map(item => item.identityKey),
  attemptedProbeCount: records.length,
  httpSuccessProbeCount: records.filter(item => item.finalResponse?.ok).length,
  parsedJsonProbeCount: records.filter(item => item.parsedJson).length,
  graphqlErrorProbeCount: records.filter(item => item.graphqlErrors.length > 0).length,
  exactItemProbeCount: records.filter(item => item.exactItemCount > 0).length,
  exactImageReferenceCount: records.reduce(
    (sum, item) => sum + item.acceptedImageCount,
    0,
  ),
  rejectedMediaCount: records.reduce(
    (sum, item) => sum + item.rejectedMediaCount,
    0,
  ),
  completedAt: new Date().toISOString(),
};
summary.summarySha256 = sha256(Buffer.from(JSON.stringify(summary)));
await writeJson(`${outDir}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
