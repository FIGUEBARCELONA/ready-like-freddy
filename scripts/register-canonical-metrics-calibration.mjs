import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { appRouter } from "../server/routers.ts";
import { getDb } from "../server/db.ts";
import { ENV } from "../server/_core/env.ts";
import { users } from "../drizzle/schema.ts";

const sourcePath = "/home/ubuntu/rlf_review/RLF_EXECUTION_DOSSIER_20260821/data/RLF_GLOBAL_CORPUS_CONSOLIDATED_NORMALIZATION_METRICS_20260822.txt";
const bytes = await readFile(sourcePath);
const text = bytes.toString("utf8");
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
const keys = new Set(["mapping_layer_rows", "effective_mapping_rows", "superseded_nonmatches", "OFFICIAL_MATCH", "OFFICIAL_SCOPE_UNCLEAR", "COLOUR_NAME_OFFICIAL_MATCH", "COLOUR_CODE_OFFICIAL_MATCH", "COLOUR_PROPAGATIONS", "SKU_MAPPINGS", "VISUAL_ASSETS_INGESTED", "quality_decision"]);
const metrics = text.split(/\r?\n/).flatMap(line => {
  const separator = line.indexOf("=");
  if (separator < 1) return [];
  const metricKey = line.slice(0, separator);
  const metricValue = line.slice(separator + 1);
  return keys.has(metricKey) ? [{ metricKey, metricValue, evidenceRef: `${sourcePath}#${metricKey}` }] : [];
});
if (!metrics.length) throw new Error("No approved metric keys were found; calibration was not created.");

const db = await getDb();
if (!db) throw new Error("Database unavailable; calibration was not created.");
const owner = (await db.select().from(users).where(eq(users.openId, ENV.ownerOpenId)).limit(1))[0];
if (!owner || owner.role !== "admin") throw new Error("Authenticated project owner with admin role is required; calibration was not created.");
const caller = appRouter.createCaller({ user: owner, req: { protocol: "https", headers: {} }, res: {} });
const registered = await caller.workstream.registerCanonicalManifest({
  manifestName: "RLF consolidated normalization metrics — 2026-08-22",
  sourcePath,
  sourceSha256,
  sourceVersion: "RLF-METRICS/2026-08-22",
  entries: [{ entryKey: "RLF_GLOBAL_CORPUS_CONSOLIDATED_NORMALIZATION_METRICS_20260822.txt", entrySha256: sourceSha256, metadata: { sourceMode: "READ_ONLY", metricCount: metrics.length } }],
});
await caller.workstream.verifyCanonicalManifest({
  importId: registered.importId,
  reason: "Métricas consolidadas leídas desde el libro canónico de solo lectura con SHA-256 coincidente.",
});
const calibration = await caller.workstream.createCalibrationRun({
  name: "RLF corpus normalization calibration — 2026-08-22",
  sourceImportId: registered.importId,
  sourceSha256,
  metrics,
});
console.log(JSON.stringify({ importId: registered.importId, calibration, metricCount: metrics.length }));
