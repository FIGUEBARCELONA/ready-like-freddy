import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { canTransition, containsFabricationMarker, fingerprintClaim, fingerprintScope, isOfficialFredPerryUrl, isSha256, normalizeScope, workItemStates } from "../../shared/workstreamPolicy";
import { evaluateVisualManifest } from "../../shared/visualForensicPolicy";
import {
  auditEvents,
  calibrationMetrics,
  calibrationRuns,
  canonicalImportEntries,
  canonicalImports,
  canonicalVariants,
  forensicDecisions,
  forensicObservations,
  incidents,
  physicalPieces,
  reassignments,
  researchPartitions,
  researchScopeClaims,
  verificationCache,
  visualAssets,
  visualManifests,
  workItemDependencies,
  workItems,
  workstreamCoverageProfiles,
  workstreams,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

const workstreamIds = Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`);
const partitionTypes = ["OFFICIAL_URL_PREFIX", "PRODUCT_CODE_FAMILY", "MODEL_FAMILY", "HISTORICAL_WINDOW", "CONTENT_CLASS", "CUSTOM"] as const;
const claimTypes = ["OFFICIAL_URL", "PRODUCT_CODE", "MODEL_NAME", "COLOUR_NAME", "FACTORY_CLAIM", "ARTICLE_SLUG"] as const;
const visualRoles = ["STD_PRIMARY", "STD_REVERSE", "STD_PROFILE_A", "STD_PROFILE_B", "MACRO_BRAND", "MACRO_REGULATORY", "MACRO_IDENTIFIER", "MACRO_CONSTRUCTION", "MACRO_SIGNATURE", "MACRO_CONDITION"] as const;
const forensicFields = ["AUTHENTICITY", "MODEL", "YEAR", "FACTORY", "COLOUR", "SIZE", "MATERIAL", "CONDITION"] as const;
const observationCategories = ["BRAND_LABEL", "REGULATORY_LABEL", "IDENTIFIER", "LAUREL_MARK", "CONSTRUCTION", "FASTENING", "MEASUREMENT", "MATERIAL_SURFACE", "ORIGIN_MARK", "TEMPORAL_COHERENCE", "CONDITION"] as const;
const evidenceDecisions = ["VERIFIED", "SUPPORTED", "INCONCLUSIVE", "CONTRADICTED"] as const;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "La base de datos no está disponible." });
  return db;
}

function rejectFabricatedContent(values: Array<string | undefined>) {
  if (values.some(value => value && containsFabricationMarker(value))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Se rechaza contenido marcado como ejemplo, placeholder, simulación, dato de prueba o fabricación." });
  }
}

async function writeAudit(input: {
  actorOpenId: string;
  eventType: string;
  reason: string;
  workstreamId?: string | null;
  workItemId?: number | null;
  incidentId?: number | null;
  previousState?: unknown;
  nextState?: unknown;
}) {
  const db = await requireDb();
  await db.insert(auditEvents).values(input);
}

async function promoteReadyDependents(actorOpenId: string, completedWorkItemId: number) {
  const db = await requireDb();
  const dependentLinks = await db.select().from(workItemDependencies).where(eq(workItemDependencies.dependsOnWorkItemId, completedWorkItemId));
  for (const link of dependentLinks) {
    const dependencies = await db.select().from(workItemDependencies).where(eq(workItemDependencies.workItemId, link.workItemId));
    const dependencyRows = await db.select().from(workItems).where(inArray(workItems.id, dependencies.map(item => item.dependsOnWorkItemId)));
    const target = (await db.select().from(workItems).where(eq(workItems.id, link.workItemId)).limit(1))[0];
    if (!target || target.status !== "WAITING_DEPENDENCY") continue;
    if (dependencyRows.length === dependencies.length && dependencyRows.every(item => item.status === "COMPLETE")) {
      await db.update(workItems).set({ status: "READY" }).where(eq(workItems.id, target.id));
      await writeAudit({
        actorOpenId,
        eventType: "WORK_ITEM_DEPENDENCIES_SATISFIED",
        workstreamId: target.workstreamId,
        workItemId: target.id,
        previousState: { status: "WAITING_DEPENDENCY" },
        nextState: { status: "READY" },
        reason: "Todas las dependencias registradas han alcanzado COMPLETE.",
      });
    }
  }
}

const officialSourceSchema = z.object({
  sourceUrl: z.string().url(),
  locale: z.string().min(2).max(32),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  observedAt: z.date(),
  locator: z.string().min(8),
});

export const workstreamRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [workstreamRows, itemRows, incidentRows, partitionRows, cacheRows, importRows, recentEvents] = await Promise.all([
      db.select().from(workstreams).orderBy(asc(workstreams.id)),
      db.select().from(workItems).orderBy(asc(workItems.priority), asc(workItems.createdAt)),
      db.select().from(incidents).orderBy(desc(incidents.createdAt)),
      db.select().from(researchPartitions).orderBy(asc(researchPartitions.workstreamId)),
      db.select().from(verificationCache).orderBy(desc(verificationCache.createdAt)),
      db.select().from(canonicalImports).orderBy(desc(canonicalImports.createdAt)),
      db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(24),
    ]);
    const slots = workstreamIds.map(id => {
      const persisted = workstreamRows.find(workstream => workstream.id === id);
      const activeItems = itemRows.filter(item => item.workstreamId === id && ["READY", "IN_PROGRESS", "BLOCKED"].includes(item.status));
      const partition = partitionRows.find(entry => entry.workstreamId === id);
      return {
        id,
        title: persisted?.title ?? "Sin inicializar",
        status: persisted?.status ?? "NOT_INITIALIZED",
        capacity: persisted?.capacity ?? 1,
        activeLoad: activeItems.length,
        dependencySummary: persisted?.dependencySummary ?? null,
        partition: partition ?? null,
        initialized: Boolean(persisted),
      };
    });
    const readyQueue = itemRows.filter(item => item.status === "READY");
    return { slots, items: itemRows, incidents: incidentRows, cache: cacheRows, imports: importRows, recentEvents, readyQueue };
  }),

  initializeSlots: adminProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();
    const existing = await db.select({ id: workstreams.id }).from(workstreams);
    const existingIds = new Set(existing.map(row => row.id));
    const missing = workstreamIds.filter(id => !existingIds.has(id));
    if (missing.length > 0) {
      await db.insert(workstreams).values(missing.map(id => ({ id, title: `Workstream ${id}`, status: "NOT_STARTED" as const, capacity: 1, activeLoad: 0 })));
      await Promise.all(missing.map(id => writeAudit({
        actorOpenId: ctx.user.openId,
        eventType: "WORKSTREAM_INITIALIZED",
        workstreamId: id,
        nextState: { status: "NOT_STARTED", capacity: 1 },
        reason: "Inicialización explícita de slot lógico; no se ha ejecutado investigación ni ingestión.",
      }))); 
    }
    const existingProfiles = await db.select({ workstreamId: workstreamCoverageProfiles.workstreamId }).from(workstreamCoverageProfiles);
    const profiledIds = new Set(existingProfiles.map(row => row.workstreamId));
    const profilesMissing = workstreamIds.filter(id => !profiledIds.has(id));
    if (profilesMissing.length > 0) {
      await db.insert(workstreamCoverageProfiles).values(profilesMissing.map(workstreamId => ({ workstreamId })));
      await Promise.all(profilesMissing.map(workstreamId => writeAudit({
        actorOpenId: ctx.user.openId,
        eventType: "WORKSTREAM_COVERAGE_CONFIGURED",
        workstreamId,
        nextState: { purpose: "KB_DOCUMENTARY_NONCOMMERCIAL", periodStart: "1940-01-01", periodEnd: "2026-08-31", geographyScope: "GLOBAL", profileStatus: "CONFIGURED_EMPTY" },
        reason: "Marco documental global configurado sin reservar fuente, variante, fábrica ni período de investigación específico.",
      })));
    }
    return { initialized: missing.length, coverageProfilesConfigured: profilesMissing.length, total: 50 };
  }),

  reservePartition: adminProcedure.input(z.object({
    workstreamId: z.enum(workstreamIds as [string, ...string[]]),
    partitionType: z.enum(partitionTypes),
    partitionKey: z.string().min(4).max(191),
    canonicalDescriptor: z.string().min(12),
    claims: z.array(z.object({ type: z.enum(claimTypes), value: z.string().min(2).max(512) })).min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.partitionKey, input.canonicalDescriptor, ...input.claims.map(claim => claim.value)]);
    const workstream = (await db.select().from(workstreams).where(eq(workstreams.id, input.workstreamId)).limit(1))[0];
    if (!workstream) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El slot debe inicializarse antes de reservar un ámbito." });
    const normalizedPartition = normalizeScope(input.partitionKey);
    const scopeFingerprint = fingerprintScope(input.partitionType, normalizedPartition);
    const normalizedClaims = input.claims.map(claim => ({ ...claim, canonical: normalizeScope(claim.value), fingerprint: fingerprintClaim(claim.type, claim.value) }));
    if (new Set(normalizedClaims.map(claim => claim.fingerprint)).size !== normalizedClaims.length) {
      throw new TRPCError({ code: "CONFLICT", message: "La reserva contiene claims duplicados." });
    }
    const [sameScope, sameWorkstream, conflictingClaims] = await Promise.all([
      db.select().from(researchPartitions).where(eq(researchPartitions.scopeFingerprint, scopeFingerprint)).limit(1),
      db.select().from(researchPartitions).where(eq(researchPartitions.workstreamId, input.workstreamId)).limit(1),
      db.select().from(researchScopeClaims).where(inArray(researchScopeClaims.claimFingerprint, normalizedClaims.map(claim => claim.fingerprint))),
    ]);
    if (sameScope.length || sameWorkstream.length || conflictingClaims.length) {
      throw new TRPCError({ code: "CONFLICT", message: "Solapamiento detectado: el alcance o alguno de sus claims canónicos ya está reservado." });
    }
    await db.insert(researchPartitions).values({
      workstreamId: input.workstreamId,
      partitionType: input.partitionType,
      partitionKey: normalizedPartition,
      scopeFingerprint,
      canonicalDescriptor: input.canonicalDescriptor.trim(),
      status: "RESERVED",
      createdByOpenId: ctx.user.openId,
    });
    const partition = (await db.select().from(researchPartitions).where(eq(researchPartitions.scopeFingerprint, scopeFingerprint)).limit(1))[0];
    if (!partition) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido confirmar la reserva de alcance." });
    await db.insert(researchScopeClaims).values(normalizedClaims.map(claim => ({
      researchPartitionId: partition.id,
      claimType: claim.type,
      canonicalValue: claim.canonical,
      claimFingerprint: claim.fingerprint,
    })));
    await db.update(workstreams).set({ status: "READY" }).where(eq(workstreams.id, input.workstreamId));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "RESEARCH_PARTITION_RESERVED", workstreamId: input.workstreamId, nextState: { partitionKey: normalizedPartition, claimCount: normalizedClaims.length }, reason: "Reserva exclusiva de investigación validada contra claims existentes." });
    return { partitionId: partition.id, scopeFingerprint };
  }),

  createWorkItem: adminProcedure.input(z.object({
    reference: z.string().regex(/^RLF-WI-[A-Z0-9-]{3,56}$/),
    title: z.string().min(4).max(220),
    description: z.string().max(4000).optional(),
    workstreamId: z.enum(workstreamIds as [string, ...string[]]),
    priority: z.number().int().min(1).max(999).default(100),
    dependencyIds: z.array(z.number().int().positive()).max(30).default([]),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.reference, input.title, input.description]);
    const [workstream, partition] = await Promise.all([
      db.select().from(workstreams).where(eq(workstreams.id, input.workstreamId)).limit(1),
      db.select().from(researchPartitions).where(and(eq(researchPartitions.workstreamId, input.workstreamId), eq(researchPartitions.status, "RESERVED"))).limit(1),
    ]);
    if (!workstream[0] || !partition[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una tarea solo puede asignarse a un workstream inicializado con una partición exclusiva reservada." });
    if (new Set(input.dependencyIds).size !== input.dependencyIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Las dependencias no pueden repetirse." });
    if (input.dependencyIds.length) {
      const dependencies = await db.select().from(workItems).where(inArray(workItems.id, input.dependencyIds));
      if (dependencies.length !== input.dependencyIds.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una o más dependencias no existen." });
    }
    const status = input.dependencyIds.length ? "WAITING_DEPENDENCY" : "READY";
    await db.insert(workItems).values({ reference: input.reference, title: input.title.trim(), description: input.description?.trim(), workstreamId: input.workstreamId, status, priority: input.priority, isReadOnly: true, requiresCanonicalEvidence: true, createdByOpenId: ctx.user.openId, assignedAt: new Date() });
    const item = (await db.select().from(workItems).where(eq(workItems.reference, input.reference)).limit(1))[0];
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido confirmar la tarea creada." });
    if (input.dependencyIds.length) await db.insert(workItemDependencies).values(input.dependencyIds.map(dependsOnWorkItemId => ({ workItemId: item.id, dependsOnWorkItemId })));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "WORK_ITEM_CREATED", workstreamId: input.workstreamId, workItemId: item.id, nextState: { status, dependencyCount: input.dependencyIds.length }, reason: "Tarea atómica de solo lectura creada en una partición exclusiva." });
    return item;
  }),

  updateWorkItemStatus: adminProcedure.input(z.object({
    workItemId: z.number().int().positive(),
    nextStatus: z.enum(workItemStates),
    reason: z.string().min(8).max(1000),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.reason]);
    const item = (await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1))[0];
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "La tarea no existe." });
    if (!canTransition(item.status, input.nextStatus)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Transición no permitida: ${item.status} → ${input.nextStatus}.` });
    const completedAt = input.nextStatus === "COMPLETE" ? new Date() : item.completedAt;
    await db.update(workItems).set({ status: input.nextStatus, completedAt }).where(eq(workItems.id, item.id));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "WORK_ITEM_STATUS_CHANGED", workstreamId: item.workstreamId, workItemId: item.id, previousState: { status: item.status }, nextState: { status: input.nextStatus }, reason: input.reason.trim() });
    if (input.nextStatus === "COMPLETE") await promoteReadyDependents(ctx.user.openId, item.id);
    return { id: item.id, status: input.nextStatus };
  }),

  reassignWorkItem: adminProcedure.input(z.object({
    workItemId: z.number().int().positive(),
    toWorkstreamId: z.enum(workstreamIds as [string, ...string[]]),
    reason: z.string().min(8).max(1000),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.reason]);
    const [item, targetPartition] = await Promise.all([
      db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1),
      db.select().from(researchPartitions).where(and(eq(researchPartitions.workstreamId, input.toWorkstreamId), eq(researchPartitions.status, "RESERVED"))).limit(1),
    ]);
    if (!item[0]) throw new TRPCError({ code: "NOT_FOUND", message: "La tarea no existe." });
    if (!targetPartition[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El workstream destino necesita una partición exclusiva reservada." });
    if (["COMPLETE", "CANCELLED"].includes(item[0].status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una tarea cerrada no puede reasignarse." });
    if (item[0].workstreamId === input.toWorkstreamId) throw new TRPCError({ code: "BAD_REQUEST", message: "La tarea ya está asignada a ese workstream." });
    await db.update(workItems).set({ workstreamId: input.toWorkstreamId, assignedAt: new Date() }).where(eq(workItems.id, item[0].id));
    await db.insert(reassignments).values({ workItemId: item[0].id, fromWorkstreamId: item[0].workstreamId, toWorkstreamId: input.toWorkstreamId, reason: input.reason.trim(), actorOpenId: ctx.user.openId });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "WORK_ITEM_REASSIGNED", workstreamId: input.toWorkstreamId, workItemId: item[0].id, previousState: { workstreamId: item[0].workstreamId }, nextState: { workstreamId: input.toWorkstreamId }, reason: input.reason.trim() });
    return { id: item[0].id, workstreamId: input.toWorkstreamId };
  }),

  createIncident: adminProcedure.input(z.object({
    workstreamId: z.enum(workstreamIds as [string, ...string[]]).optional(),
    workItemId: z.number().int().positive().optional(),
    severity: z.enum(["BLOCKING", "CONDITIONING", "INFORMATIONAL"]),
    title: z.string().min(5).max(220),
    detail: z.string().min(10).max(4000),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.title, input.detail]);
    await db.insert(incidents).values({ ...input, openedByOpenId: ctx.user.openId, status: "OPEN" });
    const incident = (await db.select().from(incidents).orderBy(desc(incidents.id)).limit(1))[0];
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "INCIDENT_OPENED", workstreamId: input.workstreamId, workItemId: input.workItemId, incidentId: incident?.id, nextState: { severity: input.severity, status: "OPEN" }, reason: input.title.trim() });
    return incident;
  }),

  registerVerification: adminProcedure.input(z.object({
    cacheKey: z.string().min(6).max(191),
    subjectType: z.string().min(2).max(64),
    subjectId: z.string().min(2).max(128),
    fieldType: z.enum(["MODEL_NAME", "PRODUCT_CODE", "COLOUR_NAME", "COLOUR_CODE"]),
    ...officialSourceSchema.shape,
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.cacheKey, input.subjectType, input.subjectId, input.sourceUrl, input.locale, input.locator]);
    if (!isOfficialFredPerryUrl(input.sourceUrl)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La caché de normalización acepta únicamente fuentes oficiales HTTPS fredperry.com." });
    await db.insert(verificationCache).values({
      cacheKey: input.cacheKey,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sourceUrl: input.sourceUrl,
      locale: input.locale,
      contentSha256: input.contentSha256.toLowerCase(),
      observedAt: input.observedAt,
      locator: `${input.fieldType}: ${input.locator}`,
      cacheStatus: "VALID",
      createdByOpenId: ctx.user.openId,
    });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "VERIFICATION_CACHED", nextState: { cacheKey: input.cacheKey, fieldType: input.fieldType }, reason: "Evidencia oficial registrada; SKU no es un tipo permitido." });
    return { cacheKey: input.cacheKey, status: "VALID" };
  }),

  invalidateVerification: adminProcedure.input(z.object({ cacheKey: z.string().min(6), reason: z.string().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.reason]);
    const entry = (await db.select().from(verificationCache).where(eq(verificationCache.cacheKey, input.cacheKey)).limit(1))[0];
    if (!entry || entry.cacheStatus !== "VALID") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Solo puede invalidarse una entrada de caché válida existente." });
    await db.update(verificationCache).set({ cacheStatus: "INVALIDATED", invalidationReason: input.reason.trim(), invalidatedAt: new Date() }).where(eq(verificationCache.id, entry.id));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "VERIFICATION_INVALIDATED", previousState: { cacheStatus: "VALID" }, nextState: { cacheStatus: "INVALIDATED", cacheKey: input.cacheKey }, reason: input.reason.trim() });
    return { cacheKey: input.cacheKey, status: "INVALIDATED" };
  }),

  registerCanonicalManifest: adminProcedure.input(z.object({
    manifestName: z.string().min(3).max(191),
    sourcePath: z.string().min(10).max(1024),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    sourceVersion: z.string().min(1).max(128),
    entries: z.array(z.object({ entryKey: z.string().min(1).max(191), entrySha256: z.string().regex(/^[a-f0-9]{64}$/i), metadata: z.record(z.string(), z.unknown()) })).min(1).max(10000),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.manifestName, input.sourcePath, input.sourceVersion, ...input.entries.flatMap(entry => [entry.entryKey, JSON.stringify(entry.metadata)])]);
    if (!input.sourcePath.startsWith("/home/ubuntu/rlf_review/RLF_EXECUTION_DOSSIER_20260821/")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El manifiesto debe apuntar a un libro canónico RLF dentro del dossier autorizado." });
    if (new Set(input.entries.map(entry => entry.entryKey)).size !== input.entries.length) throw new TRPCError({ code: "CONFLICT", message: "El manifiesto contiene claves de entrada duplicadas." });
    const db = await requireDb();
    await db.insert(canonicalImports).values({ manifestName: input.manifestName.trim(), sourcePath: input.sourcePath, sourceSha256: input.sourceSha256.toLowerCase(), sourceVersion: input.sourceVersion.trim(), importStatus: "PENDING", entryCount: input.entries.length });
    const record = (await db.select().from(canonicalImports).where(and(eq(canonicalImports.sourcePath, input.sourcePath), eq(canonicalImports.sourceSha256, input.sourceSha256.toLowerCase()))).limit(1))[0];
    if (!record) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido confirmar el manifiesto registrado." });
    await db.insert(canonicalImportEntries).values(input.entries.map(entry => ({ canonicalImportId: record.id, entryKey: entry.entryKey, entrySha256: entry.entrySha256.toLowerCase(), metadata: entry.metadata })));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "CANONICAL_MANIFEST_REGISTERED", nextState: { importId: record.id, entryCount: input.entries.length }, reason: "Manifiesto de solo lectura registrado sin escribir en su fuente." });
    return { importId: record.id, importStatus: "PENDING" };
  }),

  verifyCanonicalManifest: adminProcedure.input(z.object({ importId: z.number().int().positive(), reason: z.string().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.reason]);
    const record = (await db.select().from(canonicalImports).where(eq(canonicalImports.id, input.importId)).limit(1))[0];
    if (!record || record.importStatus !== "PENDING") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Solo puede verificarse un manifiesto pendiente." });
    const entries = await db.select().from(canonicalImportEntries).where(eq(canonicalImportEntries.canonicalImportId, record.id));
    if (entries.length !== record.entryCount || !isSha256(record.sourceSha256) || entries.some(entry => !isSha256(entry.entrySha256))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El manifiesto no supera las comprobaciones de integridad estructural." });
    await db.update(canonicalImports).set({ importStatus: "VERIFIED", verifiedByOpenId: ctx.user.openId, verifiedAt: new Date() }).where(eq(canonicalImports.id, record.id));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "CANONICAL_MANIFEST_VERIFIED", nextState: { importId: record.id, importStatus: "VERIFIED" }, reason: input.reason.trim() });
    return { importId: record.id, importStatus: "VERIFIED" };
  }),

  createCalibrationRun: adminProcedure.input(z.object({
    name: z.string().min(4).max(191),
    sourceImportId: z.number().int().positive(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    metrics: z.array(z.object({ metricKey: z.string().min(2).max(128), metricValue: z.string().min(1).max(191), evidenceRef: z.string().min(6).max(1024) })).min(1).max(500),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    rejectFabricatedContent([input.name, ...input.metrics.flatMap(metric => [metric.metricKey, metric.metricValue, metric.evidenceRef])]);
    const source = (await db.select().from(canonicalImports).where(eq(canonicalImports.id, input.sourceImportId)).limit(1))[0];
    if (!source || source.importStatus !== "VERIFIED" || source.sourceSha256 !== input.sourceSha256.toLowerCase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La calibración exige un manifiesto canónico verificado y un checksum coincidente." });
    await db.insert(calibrationRuns).values({ name: input.name.trim(), sourceImportId: source.id, sourceSha256: source.sourceSha256, status: "VERIFIED", createdByOpenId: ctx.user.openId, verifiedAt: new Date() });
    const run = (await db.select().from(calibrationRuns).orderBy(desc(calibrationRuns.id)).limit(1))[0];
    if (!run) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido confirmar la ejecución de calibración." });
    await db.insert(calibrationMetrics).values(input.metrics.map(metric => ({ calibrationRunId: run.id, ...metric })));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "CALIBRATION_RECORDED", nextState: { calibrationRunId: run.id, metricCount: input.metrics.length }, reason: "Métricas canónicas verificadas registradas para calibración." });
    return { calibrationRunId: run.id, status: "VERIFIED" };
  }),

  registerCanonicalVariant: adminProcedure.input(z.object({
    canonicalImportId: z.number().int().positive(),
    variantRef: z.string().min(4).max(96),
    productCode: z.string().min(1).max(96).optional(),
    modelName: z.string().min(1).max(191).optional(),
    sourceLocator: z.string().min(8).max(1024),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.variantRef, input.productCode, input.modelName, input.sourceLocator]);
    if (input.productCode?.toUpperCase().includes("SKU")) throw new TRPCError({ code: "BAD_REQUEST", message: "SKU está prohibido como identidad canónica de variante." });
    const db = await requireDb();
    const source = (await db.select().from(canonicalImports).where(eq(canonicalImports.id, input.canonicalImportId)).limit(1))[0];
    if (!source || source.importStatus !== "VERIFIED") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La variante exige un manifiesto canónico VERIFIED." });
    await db.insert(canonicalVariants).values({ ...input, sourceSha256: input.sourceSha256.toLowerCase(), status: "VERIFIED" });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "CANONICAL_VARIANT_REGISTERED", nextState: { variantRef: input.variantRef, canonicalImportId: input.canonicalImportId }, reason: "Variante exacta registrada desde un manifiesto canónico verificado." });
    return { variantRef: input.variantRef, status: "VERIFIED" };
  }),

  registerPhysicalPiece: adminProcedure.input(z.object({
    pieceRef: z.string().regex(/^RLF-PIECE-[A-Z0-9-]{3,80}$/),
    canonicalVariantRef: z.string().min(4).max(96),
    canonicalVariantEvidenceRef: z.string().min(8).max(1024),
    sourceContext: z.string().min(12).max(4000),
    custodyRef: z.string().min(8).max(1024),
    receivedAt: z.date(),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.pieceRef, input.canonicalVariantRef, input.canonicalVariantEvidenceRef, input.sourceContext, input.custodyRef]);
    const db = await requireDb();
    const variant = (await db.select().from(canonicalVariants).where(eq(canonicalVariants.variantRef, input.canonicalVariantRef)).limit(1))[0];
    if (!variant || variant.status !== "VERIFIED" || variant.sourceLocator !== input.canonicalVariantEvidenceRef) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La pieza exige una variante canónica VERIFIED y una referencia de evidencia exacta coincidente." });
    await db.insert(physicalPieces).values({ ...input, status: "INTAKE", createdByOpenId: ctx.user.openId });
    const piece = (await db.select().from(physicalPieces).where(eq(physicalPieces.pieceRef, input.pieceRef)).limit(1))[0];
    if (!piece) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido confirmar la pieza física." });
    await db.insert(visualManifests).values({ physicalPieceId: piece.id, manifestStatus: "INCOMPLETE", standardViewCount: 0, macroCount: 0 });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "PHYSICAL_PIECE_REGISTERED", nextState: { pieceRef: piece.pieceRef, visualManifest: "INCOMPLETE" }, reason: "Pieza física registrada sin assets ni decisión forense." });
    return { physicalPieceId: piece.id, visualManifestStatus: "INCOMPLETE" };
  }),

  registerVisualAsset: adminProcedure.input(z.object({
    physicalPieceId: z.number().int().positive(),
    role: z.enum(visualRoles),
    assetSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    storageKey: z.string().min(8).max(1024),
    mimeType: z.string().min(3).max(128),
    pixelWidth: z.number().int().positive(),
    pixelHeight: z.number().int().positive(),
    capturedAt: z.date(),
    sourceProvenance: z.string().min(12).max(4000),
    custodyRef: z.string().min(8).max(1024),
    rightsEvidenceRef: z.string().min(8).max(1024),
    scaleStatus: z.enum(["DOCUMENTED", "NOT_DOCUMENTED"]),
    scaleReference: z.string().max(2000).optional(),
    semanticEditStatus: z.enum(["UNEDITED", "DOCUMENTED_TRANSFORM"]),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.storageKey, input.sourceProvenance, input.custodyRef, input.rightsEvidenceRef, input.scaleReference]);
    const db = await requireDb();
    const [piece, manifest] = await Promise.all([
      db.select().from(physicalPieces).where(eq(physicalPieces.id, input.physicalPieceId)).limit(1),
      db.select().from(visualManifests).where(eq(visualManifests.physicalPieceId, input.physicalPieceId)).limit(1),
    ]);
    if (!piece[0] || !manifest[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La pieza y su manifiesto visual deben existir antes de registrar un asset." });
    if (manifest[0].manifestStatus === "VALIDATED") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Un manifiesto validado queda inmutable; cree una revisión controlada antes de cambiarlo." });
    await db.insert(visualAssets).values({
      visualManifestId: manifest[0].id,
      physicalPieceId: input.physicalPieceId,
      role: input.role,
      assetSha256: input.assetSha256.toLowerCase(),
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      pixelWidth: input.pixelWidth,
      pixelHeight: input.pixelHeight,
      capturedAt: input.capturedAt,
      sourceProvenance: input.sourceProvenance,
      custodyRef: input.custodyRef,
      rightsStatus: "UNKNOWN",
      rightsEvidenceRef: input.rightsEvidenceRef,
      scaleStatus: input.scaleStatus,
      scaleReference: input.scaleReference,
      semanticEditStatus: input.semanticEditStatus,
      createdByOpenId: ctx.user.openId,
    });
    const records = await db.select().from(visualAssets).where(eq(visualAssets.visualManifestId, manifest[0].id));
    const evaluation = evaluateVisualManifest(records);
    await db.update(visualManifests).set({ standardViewCount: evaluation.standardViewCount, macroCount: evaluation.macroCount, manifestStatus: evaluation.complete ? "READY_FOR_REVIEW" : "INCOMPLETE", blockReason: evaluation.complete ? null : evaluation.blockReasons.join(" ") }).where(eq(visualManifests.id, manifest[0].id));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "VISUAL_ASSET_REGISTERED", nextState: { physicalPieceId: input.physicalPieceId, role: input.role, rightsStatus: "UNKNOWN", manifestStatus: evaluation.complete ? "READY_FOR_REVIEW" : "INCOMPLETE" }, reason: "Asset registrado con hash y evidencia de derechos pendiente de revisión humana." });
    return { manifestStatus: evaluation.complete ? "READY_FOR_REVIEW" : "INCOMPLETE", blockReasons: evaluation.blockReasons };
  }),

  reviewVisualRights: adminProcedure.input(z.object({
    visualAssetId: z.number().int().positive(),
    decision: z.enum(["ACREDITED", "REJECTED"]),
    reason: z.string().min(12).max(1000),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.reason]);
    const db = await requireDb();
    const asset = (await db.select().from(visualAssets).where(eq(visualAssets.id, input.visualAssetId)).limit(1))[0];
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "El asset visual no existe." });
    if (!asset.rightsEvidenceRef) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se puede revisar un asset sin referencia de evidencia de derechos." });
    if (asset.rightsStatus !== "UNKNOWN") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El estado de derechos ya fue revisado y no puede sobrescribirse sin una revisión de excepción." });
    await db.update(visualAssets).set({ rightsStatus: input.decision, rightsReviewedByOpenId: ctx.user.openId, rightsReviewedAt: new Date(), rightsReviewReason: input.reason.trim() }).where(eq(visualAssets.id, asset.id));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "VISUAL_RIGHTS_REVIEWED", nextState: { visualAssetId: asset.id, rightsStatus: input.decision }, reason: input.reason.trim() });
    return { visualAssetId: asset.id, rightsStatus: input.decision };
  }),

  validateVisualManifest: adminProcedure.input(z.object({
    physicalPieceId: z.number().int().positive(),
    physicalReviewCompleted: z.literal(true),
    reason: z.string().min(12).max(1000),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.reason]);
    const db = await requireDb();
    const manifest = (await db.select().from(visualManifests).where(eq(visualManifests.physicalPieceId, input.physicalPieceId)).limit(1))[0];
    if (!manifest) throw new TRPCError({ code: "NOT_FOUND", message: "No existe manifiesto visual para esta pieza." });
    const records = await db.select().from(visualAssets).where(eq(visualAssets.visualManifestId, manifest.id));
    const evaluation = evaluateVisualManifest(records);
    if (!evaluation.complete) {
      await db.update(visualManifests).set({ manifestStatus: "BLOCKED", blockReason: evaluation.blockReasons.join(" ") }).where(eq(visualManifests.id, manifest.id));
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `El manifiesto queda bloqueado: ${evaluation.blockReasons.join(" ")}` });
    }
    await db.update(visualManifests).set({ manifestStatus: "VALIDATED", validatedByOpenId: ctx.user.openId, validatedAt: new Date(), blockReason: null }).where(eq(visualManifests.id, manifest.id));
    await db.update(physicalPieces).set({ status: "DOCUMENTED" }).where(eq(physicalPieces.id, input.physicalPieceId));
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "VISUAL_MANIFEST_VALIDATED", nextState: { physicalPieceId: input.physicalPieceId, standardViews: evaluation.standardViewCount, macros: evaluation.macroCount }, reason: input.reason.trim() });
    return { manifestStatus: "VALIDATED", standardViewCount: evaluation.standardViewCount, macroCount: evaluation.macroCount };
  }),

  recordForensicObservation: adminProcedure.input(z.object({
    physicalPieceId: z.number().int().positive(),
    visualAssetId: z.number().int().positive(),
    category: z.enum(observationCategories),
    targetField: z.enum(forensicFields),
    observation: z.string().min(8).max(4000),
    locator: z.string().min(4).max(2000),
    decision: z.enum(evidenceDecisions),
    sourceRef: z.string().min(6).max(1024).optional(),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.observation, input.locator, input.sourceRef]);
    const db = await requireDb();
    const [assetRows, manifestRows] = await Promise.all([
      db.select().from(visualAssets).where(and(eq(visualAssets.id, input.visualAssetId), eq(visualAssets.physicalPieceId, input.physicalPieceId))).limit(1),
      db.select().from(visualManifests).where(eq(visualManifests.physicalPieceId, input.physicalPieceId)).limit(1),
    ]);
    const asset = assetRows[0];
    const manifest = manifestRows[0];
    if (!asset || asset.rightsStatus !== "ACREDITED") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La observación exige un asset acreditado perteneciente a la misma pieza." });
    if (input.decision === "VERIFIED" && manifest?.manifestStatus !== "VALIDATED") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una observación no puede ser VERIFIED antes de validar el manifiesto visual completo." });
    await db.insert(forensicObservations).values({ ...input, createdByOpenId: ctx.user.openId });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "FORENSIC_OBSERVATION_RECORDED", nextState: { physicalPieceId: input.physicalPieceId, targetField: input.targetField, decision: input.decision }, reason: "Observación visual localizada y trazable registrada." });
    return { decision: input.decision };
  }),

  recordForensicDecision: adminProcedure.input(z.object({
    physicalPieceId: z.number().int().positive(),
    field: z.enum(forensicFields),
    decision: z.enum(evidenceDecisions),
    valueLiteral: z.string().max(4000).optional(),
    rationale: z.string().min(12).max(4000),
    evidenceRef: z.string().min(6).max(1024),
    physicalReviewCompleted: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    rejectFabricatedContent([input.valueLiteral, input.rationale, input.evidenceRef]);
    const db = await requireDb();
    const manifest = (await db.select().from(visualManifests).where(eq(visualManifests.physicalPieceId, input.physicalPieceId)).limit(1))[0];
    if (!manifest) throw new TRPCError({ code: "NOT_FOUND", message: "La pieza no tiene manifiesto visual." });
    const observations = await db.select().from(forensicObservations).where(and(eq(forensicObservations.physicalPieceId, input.physicalPieceId), eq(forensicObservations.targetField, input.field)));
    if (input.decision === "VERIFIED" && (manifest.manifestStatus !== "VALIDATED" || !input.physicalReviewCompleted || !observations.some(observation => observation.decision === "VERIFIED"))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "VERIFIED requiere manifiesto validado, revisión física confirmada y una observación VERIFIED para el campo." });
    }
    await db.insert(forensicDecisions).values({ physicalPieceId: input.physicalPieceId, field: input.field, decision: input.decision, valueLiteral: input.valueLiteral, rationale: input.rationale, evidenceRef: input.evidenceRef, requiresPhysicalReview: !input.physicalReviewCompleted, reviewedByOpenId: input.physicalReviewCompleted ? ctx.user.openId : null, reviewedAt: input.physicalReviewCompleted ? new Date() : null }).onDuplicateKeyUpdate({ set: { decision: input.decision, valueLiteral: input.valueLiteral, rationale: input.rationale, evidenceRef: input.evidenceRef, requiresPhysicalReview: !input.physicalReviewCompleted, reviewedByOpenId: input.physicalReviewCompleted ? ctx.user.openId : null, reviewedAt: input.physicalReviewCompleted ? new Date() : null } });
    await writeAudit({ actorOpenId: ctx.user.openId, eventType: "FORENSIC_DECISION_RECORDED", nextState: { physicalPieceId: input.physicalPieceId, field: input.field, decision: input.decision }, reason: input.rationale.trim() });
    return { field: input.field, decision: input.decision };
  }),

  visualOverview: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [pieces, manifests, assets, decisions, observations] = await Promise.all([
      db.select().from(physicalPieces).orderBy(desc(physicalPieces.createdAt)),
      db.select().from(visualManifests).orderBy(desc(visualManifests.updatedAt)),
      db.select().from(visualAssets).orderBy(desc(visualAssets.createdAt)),
      db.select().from(forensicDecisions).orderBy(desc(forensicDecisions.updatedAt)),
      db.select().from(forensicObservations).orderBy(desc(forensicObservations.createdAt)),
    ]);
    const accreditedAssets = assets.filter(asset => asset.rightsStatus === "ACREDITED");
    const pendingAssets = assets.filter(asset => asset.rightsStatus === "UNKNOWN");
    const rejectedAssets = assets.filter(asset => asset.rightsStatus === "REJECTED");
    const summaries = pieces.map(piece => {
      const manifest = manifests.find(entry => entry.physicalPieceId === piece.id) ?? null;
      const pieceAssets = accreditedAssets.filter(asset => asset.physicalPieceId === piece.id);
      const quarantinedAssetCount = assets.filter(asset => asset.physicalPieceId === piece.id && asset.rightsStatus !== "ACREDITED").length;
      const pieceDecisions = decisions.filter(decision => decision.physicalPieceId === piece.id);
      const pieceObservations = observations.filter(observation => observation.physicalPieceId === piece.id);
      return { piece, manifest, assetCount: pieceAssets.length, quarantinedAssetCount, decisions: pieceDecisions, observationCount: pieceObservations.length };
    });
    return { summaries, totalAssetCount: assets.length, accreditedAssetCount: accreditedAssets.length, pendingAssetCount: pendingAssets.length, rejectedAssetCount: rejectedAssets.length, decisions, observations };
  }),

  auditLog: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(input.limit);
  }),
});
