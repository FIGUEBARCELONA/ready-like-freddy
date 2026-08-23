import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface WorkerSummary {
  slot: string;
  attemptedUrlCount?: number;
  successfulFetchCount?: number;
  failedFetchCount?: number;
  uniqueProductUrlCount?: number;
  assignedProductCount?: number;
  attemptedProductCount?: number;
  successfulProductFetchCount?: number;
  failedProductFetchCount?: number;
  imageReferenceCount?: number;
  completedAt?: string;
}

interface DiscoveryManifest {
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
  manifestSha256?: string;
  completedAt?: string;
}

interface ProductManifest {
  runId: string;
  workerCount: number;
  orchestrationStatus?: string;
  transportStatus?: string;
  qualityGatePassed?: boolean;
  totals?: Record<string, number>;
  workerSummaries?: WorkerSummary[];
  productStatus?: string;
  imageStatus?: string;
  manifestSha256?: string;
  completedAt?: string;
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

export async function loadLatestExecutionStatus() {
  const runsRoot = resolve(
    process.env.RLF_EXECUTION_RUNS_DIR ?? resolve(process.cwd(), "data/execution/runs"),
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
    const discovery = await readOptionalJson<DiscoveryManifest>(resolve(runRoot, "manifest.json"));
    if (!discovery) continue;
    const product = await readOptionalJson<ProductManifest>(
      resolve(runRoot, "product-manifest.json"),
    );
    const discoveryWorkers = new Map(
      (discovery.workerSummaries ?? []).map(worker => [worker.slot, worker]),
    );
    const productWorkers = new Map((product?.workerSummaries ?? []).map(worker => [worker.slot, worker]));
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
              status:
                (productWorker.successfulProductFetchCount ?? 0) > 0 ? "COMPLETE" : "FAILED",
              assigned: productWorker.assignedProductCount ?? 0,
              attempted: productWorker.attemptedProductCount ?? 0,
              successful: productWorker.successfulProductFetchCount ?? 0,
              failed: productWorker.failedProductFetchCount ?? 0,
              images: productWorker.imageReferenceCount ?? 0,
              completedAt: productWorker.completedAt ?? null,
            }
          : null,
      };
    });

    const discoveryTotals = discovery.totals ?? {};
    const productTotals = product?.totals ?? {};
    const blockers = new Set<string>();
    if ((discoveryTotals.directSourceCount ?? 0) === 0) blockers.add("ORIGIN_CLOUDFLARE_BLOCKED");
    if ((discoveryTotals.transformedReaderSourceCount ?? 0) > 0) blockers.add("TRANSFORMED_READER_ONLY");
    if (!product) blockers.add("PRODUCT_STAGE_NOT_PERSISTED");
    if (/RIGHTS_UNKNOWN/i.test(discovery.imageStatus ?? "")) blockers.add("IMAGE_RIGHTS_UNKNOWN");
    blockers.add("CANONICAL_DEDUPLICATION_PENDING");
    blockers.add("HISTORICAL_COVERAGE_INCOMPLETE");

    const discoveryCompleteWorkers = workers.filter(
      worker => worker.discovery?.status === "COMPLETE",
    ).length;
    const productCompleteWorkers = workers.filter(worker => worker.product?.status === "COMPLETE").length;
    const backendOperational =
      discovery.workerCount === 50 &&
      discoveryCompleteWorkers === 50 &&
      Boolean(discovery.qualityGatePassed);

    return {
      backendConnected: true,
      backendStatus: backendOperational ? "OPERATIONAL" : "DEGRADED",
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
            totals: productTotals,
            manifestSha256: product.manifestSha256 ?? null,
            completedAt: product.completedAt ?? null,
          }
        : null,
      workers,
      counters: {
        productUrlCandidates: discoveryTotals.uniqueProductUrlCount ?? 0,
        productPagesCaptured: productTotals.uniqueCapturedProductUrlCount ?? 0,
        imageReferences:
          productTotals.imageReferenceCount ?? discoveryTotals.productCandidateImageReferenceCount ?? discoveryTotals.imageReferenceCount ?? 0,
        canonicalUniqueProducts: 0,
      },
      blockers: [...blockers],
      productStatus: product?.productStatus ?? discovery.productStatus ?? null,
      imageStatus: product?.imageStatus ?? discovery.imageStatus ?? null,
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
    workers: Array.from({ length: 50 }, (_, index) => ({
      slot: `F${String(index + 1).padStart(2, "0")}`,
      discovery: null,
      product: null,
    })),
    counters: {
      productUrlCandidates: 0,
      productPagesCaptured: 0,
      imageReferences: 0,
      canonicalUniqueProducts: 0,
    },
    blockers: ["EXECUTION_MANIFEST_NOT_FOUND"],
    productStatus: null,
    imageStatus: null,
  };
}
