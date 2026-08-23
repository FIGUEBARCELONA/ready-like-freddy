import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface WorkerSummary {
  slot: string;
  attemptedUrlCount?: number;
  successfulFetchCount?: number;
  failedFetchCount?: number;
  uniqueProductUrlCount?: number;
  assignedProductCount?: number;
  expectedProductCount?: number;
  attemptedProductCount?: number;
  successfulProductFetchCount?: number;
  failedProductFetchCount?: number;
  aliasFallbackSuccessCount?: number;
  imageReferenceCount?: number;
  completedAt?: string;
}

interface ExecutionManifest {
  runId: string;
  workerCount: number;
  orchestrationStatus?: string;
  transportStatus?: string;
  extractionStatus?: string;
  qualityGatePassed?: boolean;
  totals?: Record<string, number>;
  workerSummaries?: WorkerSummary[];
  productStatus?: string;
  imageStatus?: string;
  factoryStatus?: string;
  manifestSha256?: string;
  completedAt?: string;
}

interface ProductProgress {
  sourceRunId?: string;
  frontier?: {
    candidateUrlCount?: number;
    candidateIdentityCount?: number;
    aliasUrlCount?: number;
  };
  completed?: {
    identityCount?: number;
    productUrlCaptureCount?: number;
    identityKeys?: string[];
    productUrls?: string[];
  };
  retry?: {
    identityCount?: number;
    identities?: Array<{ identityKey: string }>;
  };
  counters?: {
    officialProductImageReferenceCount?: number;
    materialEvidenceCount?: number;
    manufacturingClaimCount?: number;
    factoryVerifiedCount?: number;
    globalCanonicalProductCount?: number;
  };
  progressSha256?: string;
  status?: string;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function productWorkerStatus(worker: WorkerSummary) {
  const attempted = worker.attemptedProductCount ?? 0;
  const successful = worker.successfulProductFetchCount ?? 0;
  const failed = worker.failedProductFetchCount ?? 0;
  const expected = worker.expectedProductCount ?? attempted;
  if (attempted === 0) return "NOT_RUN";
  if (successful === 0 && failed > 0) return "FAILED";
  if (failed > 0 || successful < expected) return "PARTIAL";
  return "COMPLETE";
}

export async function loadLatestExecutionStatus() {
  const executionRoot = resolve(
    process.env.RLF_EXECUTION_DATA_DIR ?? resolve(process.cwd(), "data/execution"),
  );
  const runsRoot = resolve(
    process.env.RLF_EXECUTION_RUNS_DIR ?? resolve(executionRoot, "runs"),
  );
  const progress = await readOptionalJson<ProductProgress>(
    resolve(executionRoot, "product-progress.json"),
  );

  let runIds: string[] = [];
  try {
    runIds = (await readdir(runsRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => Number(b) - Number(a));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  for (const runId of runIds) {
    const runRoot = resolve(runsRoot, runId);
    const discovery = await readOptionalJson<ExecutionManifest>(
      resolve(runRoot, "manifest.json"),
    );
    if (!discovery) continue;
    const product = await readOptionalJson<ExecutionManifest>(
      resolve(runRoot, "product-manifest.json"),
    );
    const discoveryWorkers = new Map(
      (discovery.workerSummaries ?? []).map(worker => [worker.slot, worker]),
    );
    const productWorkers = new Map(
      (product?.workerSummaries ?? []).map(worker => [worker.slot, worker]),
    );
    const workers = Array.from({ length: 50 }, (_, index) => {
      const slot = `F${String(index + 1).padStart(2, "0")}`;
      const discoveryWorker = discoveryWorkers.get(slot) ?? null;
      const productWorker = productWorkers.get(slot) ?? null;
      return {
        slot,
        discovery: discoveryWorker
          ? {
              status:
                (discoveryWorker.successfulFetchCount ?? 0) > 0 ? "COMPLETE" : "FAILED",
              attempted: discoveryWorker.attemptedUrlCount ?? 0,
              successful: discoveryWorker.successfulFetchCount ?? 0,
              failed: discoveryWorker.failedFetchCount ?? 0,
              productUrls: discoveryWorker.uniqueProductUrlCount ?? 0,
              images: discoveryWorker.imageReferenceCount ?? 0,
              completedAt: discoveryWorker.completedAt ?? null,
            }
          : null,
        product: productWorker
          ? {
              status: productWorkerStatus(productWorker),
              assigned: productWorker.assignedProductCount ?? 0,
              expected: productWorker.expectedProductCount ?? 0,
              attempted: productWorker.attemptedProductCount ?? 0,
              successful: productWorker.successfulProductFetchCount ?? 0,
              failed: productWorker.failedProductFetchCount ?? 0,
              aliasFallbackSuccesses: productWorker.aliasFallbackSuccessCount ?? 0,
              images: productWorker.imageReferenceCount ?? 0,
              completedAt: productWorker.completedAt ?? null,
            }
          : null,
      };
    });

    const discoveryTotals = discovery.totals ?? {};
    const productTotals = product?.totals ?? {};
    const retryIdentityCount =
      progress?.retry?.identityCount ?? progress?.retry?.identities?.length ?? 0;
    const blockers = new Set<string>();
    if ((discoveryTotals.directSourceCount ?? 0) === 0) {
      blockers.add("ORIGIN_CLOUDFLARE_BLOCKED");
    }
    if ((discoveryTotals.transformedReaderSourceCount ?? 0) > 0) {
      blockers.add("TRANSFORMED_READER_ONLY");
    }
    if (!product) blockers.add("PRODUCT_STAGE_NOT_PERSISTED");
    if (product && !product.qualityGatePassed) blockers.add("LATEST_PRODUCT_BATCH_PARTIAL");
    if (retryIdentityCount > 0) blockers.add("PRODUCT_IDENTITY_RETRIES_PENDING");
    if (/RIGHTS_UNKNOWN/i.test(product?.imageStatus ?? discovery.imageStatus ?? "")) {
      blockers.add("IMAGE_RIGHTS_UNKNOWN");
    }
    blockers.add("GLOBAL_CANONICAL_DEDUPLICATION_PENDING");
    blockers.add("HISTORICAL_COVERAGE_INCOMPLETE");
    blockers.add("FACTORY_VERIFICATION_INCOMPLETE");

    const discoveryCompleteWorkers = workers.filter(
      worker => worker.discovery?.status === "COMPLETE",
    ).length;
    const productCompleteWorkers = workers.filter(
      worker => worker.product?.status === "COMPLETE",
    ).length;
    const productPartialWorkers = workers.filter(
      worker => worker.product?.status === "PARTIAL",
    ).length;
    const backendOperational =
      discovery.workerCount === 50 &&
      discoveryCompleteWorkers === 50 &&
      Boolean(discovery.qualityGatePassed);
    const latestBatchHealthy = !product || Boolean(product.qualityGatePassed);

    const productUrlCandidates =
      discoveryTotals.uniqueProductUrlCount ?? progress?.frontier?.candidateUrlCount ?? 0;
    const productIdentityCandidates =
      discoveryTotals.uniqueProductIdentityCount ??
      progress?.frontier?.candidateIdentityCount ??
      0;
    const aliasProductUrls =
      discoveryTotals.aliasProductUrlCount ?? progress?.frontier?.aliasUrlCount ?? 0;
    const productPagesCaptured =
      progress?.completed?.productUrlCaptureCount ??
      productTotals.uniqueCapturedProductUrlCount ??
      productTotals.successfulProductFetchCount ??
      0;
    const productIdentitiesCaptured =
      progress?.completed?.identityCount ??
      productTotals.successfulIdentityCaptureCount ??
      0;

    return {
      backendConnected: true,
      backendStatus:
        backendOperational && latestBatchHealthy ? "OPERATIONAL" : "DEGRADED",
      provider: "GITHUB_ACTIONS_PERSISTED_MANIFEST",
      latestRunId: runId,
      runUrl: `https://github.com/FIGUEBARCELONA/ready-like-freddy/actions/runs/${runId}`,
      discovery: {
        orchestrationStatus: discovery.orchestrationStatus ?? null,
        transportStatus: discovery.transportStatus ?? null,
        extractionStatus: discovery.extractionStatus ?? null,
        qualityGatePassed: Boolean(discovery.qualityGatePassed),
        completedWorkers: discoveryCompleteWorkers,
        totals: discoveryTotals,
        manifestSha256: discovery.manifestSha256 ?? null,
        completedAt: discovery.completedAt ?? null,
      },
      product: product
        ? {
            orchestrationStatus: product.orchestrationStatus ?? null,
            transportStatus: product.transportStatus ?? null,
            qualityGatePassed: Boolean(product.qualityGatePassed),
            completedWorkers: productCompleteWorkers,
            partialWorkers: productPartialWorkers,
            totals: productTotals,
            manifestSha256: product.manifestSha256 ?? null,
            completedAt: product.completedAt ?? null,
          }
        : null,
      progress: progress
        ? {
            sourceRunId: progress.sourceRunId ?? null,
            status: progress.status ?? null,
            progressSha256: progress.progressSha256 ?? null,
            retryIdentityCount,
          }
        : null,
      workers,
      counters: {
        productUrlCandidates,
        productIdentityCandidates,
        aliasProductUrls,
        productPagesCaptured,
        productIdentitiesCaptured,
        retryIdentityCount,
        imageReferences:
          progress?.counters?.officialProductImageReferenceCount ??
          productTotals.officialProductImageReferenceCount ??
          discoveryTotals.productCandidateImageReferenceCount ??
          0,
        materialEvidence:
          progress?.counters?.materialEvidenceCount ??
          productTotals.materialEvidenceCount ??
          0,
        manufacturingClaims:
          progress?.counters?.manufacturingClaimCount ??
          productTotals.manufacturingClaimCount ??
          0,
        factoryVerified:
          progress?.counters?.factoryVerifiedCount ??
          productTotals.factoryVerifiedCount ??
          0,
        canonicalUniqueProducts:
          progress?.counters?.globalCanonicalProductCount ?? 0,
      },
      blockers: [...blockers],
      productStatus: product?.productStatus ?? discovery.productStatus ?? null,
      imageStatus: product?.imageStatus ?? discovery.imageStatus ?? null,
      factoryStatus: product?.factoryStatus ?? null,
    };
  }

  return {
    backendConnected: false,
    backendStatus: "NOT_CONNECTED",
    provider: null,
    latestRunId: null,
    runUrl: null,
    discovery: null,
    product: null,
    progress: progress
      ? {
          sourceRunId: progress.sourceRunId ?? null,
          status: progress.status ?? null,
          progressSha256: progress.progressSha256 ?? null,
          retryIdentityCount:
            progress.retry?.identityCount ?? progress.retry?.identities?.length ?? 0,
        }
      : null,
    workers: Array.from({ length: 50 }, (_, index) => ({
      slot: `F${String(index + 1).padStart(2, "0")}`,
      discovery: null,
      product: null,
    })),
    counters: {
      productUrlCandidates: progress?.frontier?.candidateUrlCount ?? 0,
      productIdentityCandidates: progress?.frontier?.candidateIdentityCount ?? 0,
      aliasProductUrls: progress?.frontier?.aliasUrlCount ?? 0,
      productPagesCaptured: progress?.completed?.productUrlCaptureCount ?? 0,
      productIdentitiesCaptured: progress?.completed?.identityCount ?? 0,
      retryIdentityCount:
        progress?.retry?.identityCount ?? progress?.retry?.identities?.length ?? 0,
      imageReferences: progress?.counters?.officialProductImageReferenceCount ?? 0,
      materialEvidence: progress?.counters?.materialEvidenceCount ?? 0,
      manufacturingClaims: progress?.counters?.manufacturingClaimCount ?? 0,
      factoryVerified: progress?.counters?.factoryVerifiedCount ?? 0,
      canonicalUniqueProducts: progress?.counters?.globalCanonicalProductCount ?? 0,
    },
    blockers: ["EXECUTION_MANIFEST_NOT_FOUND"],
    productStatus: null,
    imageStatus: null,
    factoryStatus: null,
  };
}
