import { boolean, foreignKey, index, int, json, mysqlEnum, mysqlTable, primaryKey, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const workstreamStatus = ["NOT_STARTED", "READY", "ACTIVE", "BLOCKED", "PAUSED", "COMPLETE", "FAILED"] as const;
export const workItemStatus = ["QUEUED", "WAITING_DEPENDENCY", "READY", "IN_PROGRESS", "BLOCKED", "COMPLETE", "FAILED", "CANCELLED"] as const;
export const incidentStatus = ["OPEN", "INVESTIGATING", "RESOLVED", "ESCALATED"] as const;
export const importStatus = ["PENDING", "VERIFIED", "REJECTED"] as const;
export const cacheStatus = ["VALID", "INVALIDATED", "SUPERSEDED"] as const;
export const researchPartitionStatus = ["RESERVED", "ACTIVE", "BLOCKED", "RETIRED"] as const;
export const researchPartitionType = ["OFFICIAL_URL_PREFIX", "PRODUCT_CODE_FAMILY", "MODEL_FAMILY", "HISTORICAL_WINDOW", "CONTENT_CLASS", "CUSTOM"] as const;
export const researchPurpose = ["KB_DOCUMENTARY_NONCOMMERCIAL"] as const;
export const researchClaimType = ["OFFICIAL_URL", "PRODUCT_CODE", "MODEL_NAME", "COLOUR_NAME", "FACTORY_CLAIM", "ARTICLE_SLUG"] as const;
export const pieceStatus = ["INTAKE", "DOCUMENTED", "REVIEW_REQUIRED", "ARCHIVED"] as const;
export const visualManifestStatus = ["INCOMPLETE", "READY_FOR_REVIEW", "VALIDATED", "BLOCKED"] as const;
export const visualRole = ["STD_PRIMARY", "STD_REVERSE", "STD_PROFILE_A", "STD_PROFILE_B", "MACRO_BRAND", "MACRO_REGULATORY", "MACRO_IDENTIFIER", "MACRO_CONSTRUCTION", "MACRO_SIGNATURE", "MACRO_CONDITION"] as const;
export const visualRightsStatus = ["ACREDITED", "UNKNOWN", "REJECTED"] as const;
export const evidenceDecision = ["VERIFIED", "SUPPORTED", "INCONCLUSIVE", "CONTRADICTED"] as const;
export const forensicField = ["AUTHENTICITY", "MODEL", "YEAR", "FACTORY", "COLOUR", "SIZE", "MATERIAL", "CONDITION"] as const;
export const observationCategory = ["BRAND_LABEL", "REGULATORY_LABEL", "IDENTIFIER", "LAUREL_MARK", "CONSTRUCTION", "FASTENING", "MEASUREMENT", "MATERIAL_SURFACE", "ORIGIN_MARK", "TEMPORAL_COHERENCE", "CONDITION"] as const;

export const workstreams = mysqlTable("workstreams", {
  id: varchar("id", { length: 3 }).primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  status: mysqlEnum("status", workstreamStatus).notNull().default("NOT_STARTED"),
  capacity: int("capacity").notNull().default(1),
  activeLoad: int("activeLoad").notNull().default(0),
  dependencySummary: text("dependencySummary"),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const workstreamCoverageProfiles = mysqlTable("workstream_coverage_profiles", {
  workstreamId: varchar("workstreamId", { length: 3 }).primaryKey().references(() => workstreams.id),
  purpose: mysqlEnum("purpose", ["KB_DOCUMENTARY_NONCOMMERCIAL"]).notNull().default("KB_DOCUMENTARY_NONCOMMERCIAL"),
  periodStart: varchar("periodStart", { length: 10 }).notNull().default("1940-01-01"),
  periodEnd: varchar("periodEnd", { length: 10 }).notNull().default("2026-08-31"),
  geographyScope: mysqlEnum("geographyScope", ["GLOBAL"]).notNull().default("GLOBAL"),
  profileStatus: mysqlEnum("profileStatus", ["CONFIGURED_EMPTY"]).notNull().default("CONFIGURED_EMPTY"),
  exclusivityRule: mysqlEnum("exclusivityRule", ["CLAIM_BEFORE_WORK"]).notNull().default("CLAIM_BEFORE_WORK"),
  configuredAt: timestamp("configuredAt").defaultNow().notNull(),
});

export const researchPartitions = mysqlTable("research_partitions", {
  id: int("id").autoincrement().primaryKey(),
  workstreamId: varchar("workstreamId", { length: 3 }).notNull().unique().references(() => workstreams.id),
  partitionType: mysqlEnum("partitionType", researchPartitionType).notNull(),
  purpose: mysqlEnum("purpose", researchPurpose).notNull().default("KB_DOCUMENTARY_NONCOMMERCIAL"),
  partitionKey: varchar("partitionKey", { length: 191 }).notNull().unique(),
  scopeFingerprint: varchar("scopeFingerprint", { length: 64 }).notNull().unique(),
  canonicalDescriptor: text("canonicalDescriptor").notNull(),
  status: mysqlEnum("status", researchPartitionStatus).notNull().default("RESERVED"),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  retiredAt: timestamp("retiredAt"),
}, table => [index("research_partitions_status_idx").on(table.status)]);

export const researchScopeClaims = mysqlTable("research_scope_claims", {
  id: int("id").autoincrement().primaryKey(),
  researchPartitionId: int("researchPartitionId").notNull(),
  claimType: mysqlEnum("claimType", researchClaimType).notNull(),
  canonicalValue: varchar("canonicalValue", { length: 512 }).notNull(),
  claimFingerprint: varchar("claimFingerprint", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  foreignKey({ columns: [table.researchPartitionId], foreignColumns: [researchPartitions.id], name: "rsc_partition_fk" }),
  index("research_scope_claims_partition_idx").on(table.researchPartitionId),
  index("research_scope_claims_type_value_idx").on(table.claimType, table.canonicalValue),
]);

export const physicalPieces = mysqlTable("physical_pieces", {
  id: int("id").autoincrement().primaryKey(),
  pieceRef: varchar("pieceRef", { length: 96 }).notNull().unique(),
  canonicalVariantRef: varchar("canonicalVariantRef", { length: 96 }).notNull(),
  canonicalVariantEvidenceRef: varchar("canonicalVariantEvidenceRef", { length: 1024 }).notNull(),
  status: mysqlEnum("status", pieceStatus).notNull().default("INTAKE"),
  sourceContext: text("sourceContext").notNull(),
  custodyRef: varchar("custodyRef", { length: 1024 }).notNull(),
  receivedAt: timestamp("receivedAt").notNull(),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("physical_pieces_variant_idx").on(table.canonicalVariantRef)]);

export const visualManifests = mysqlTable("visual_manifests", {
  id: int("id").autoincrement().primaryKey(),
  physicalPieceId: int("physicalPieceId").notNull().unique(),
  manifestStatus: mysqlEnum("manifestStatus", visualManifestStatus).notNull().default("INCOMPLETE"),
  standardViewCount: int("standardViewCount").notNull().default(0),
  macroCount: int("macroCount").notNull().default(0),
  validatedByOpenId: varchar("validatedByOpenId", { length: 64 }),
  validatedAt: timestamp("validatedAt"),
  blockReason: text("blockReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [foreignKey({ columns: [table.physicalPieceId], foreignColumns: [physicalPieces.id], name: "vm_piece_fk" })]);

export const visualAssets = mysqlTable("visual_assets", {
  id: int("id").autoincrement().primaryKey(),
  visualManifestId: int("visualManifestId").notNull(),
  physicalPieceId: int("physicalPieceId").notNull(),
  role: mysqlEnum("role", visualRole).notNull(),
  assetSha256: varchar("assetSha256", { length: 64 }).notNull().unique(),
  storageKey: varchar("storageKey", { length: 1024 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  pixelWidth: int("pixelWidth").notNull(),
  pixelHeight: int("pixelHeight").notNull(),
  capturedAt: timestamp("capturedAt").notNull(),
  sourceProvenance: text("sourceProvenance").notNull(),
  custodyRef: varchar("custodyRef", { length: 1024 }).notNull(),
  rightsStatus: mysqlEnum("rightsStatus", visualRightsStatus).notNull().default("UNKNOWN"),
  rightsEvidenceRef: varchar("rightsEvidenceRef", { length: 1024 }),
  rightsReviewedByOpenId: varchar("rightsReviewedByOpenId", { length: 64 }),
  rightsReviewedAt: timestamp("rightsReviewedAt"),
  rightsReviewReason: text("rightsReviewReason"),
  scaleStatus: mysqlEnum("scaleStatus", ["DOCUMENTED", "NOT_DOCUMENTED"]).notNull().default("NOT_DOCUMENTED"),
  scaleReference: text("scaleReference"),
  semanticEditStatus: mysqlEnum("semanticEditStatus", ["UNEDITED", "DOCUMENTED_TRANSFORM", "REJECTED"]).notNull().default("UNEDITED"),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  foreignKey({ columns: [table.visualManifestId], foreignColumns: [visualManifests.id], name: "va_manifest_fk" }),
  foreignKey({ columns: [table.physicalPieceId], foreignColumns: [physicalPieces.id], name: "va_piece_fk" }),
  unique("visual_assets_manifest_role_unique").on(table.visualManifestId, table.role),
  index("visual_assets_piece_idx").on(table.physicalPieceId),
  index("visual_assets_rights_idx").on(table.rightsStatus),
]);

export const forensicObservations = mysqlTable("forensic_observations", {
  id: int("id").autoincrement().primaryKey(),
  physicalPieceId: int("physicalPieceId").notNull(),
  visualAssetId: int("visualAssetId").notNull(),
  category: mysqlEnum("category", observationCategory).notNull(),
  targetField: mysqlEnum("targetField", forensicField).notNull(),
  observation: text("observation").notNull(),
  locator: text("locator").notNull(),
  decision: mysqlEnum("decision", evidenceDecision).notNull(),
  sourceRef: varchar("sourceRef", { length: 1024 }),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  foreignKey({ columns: [table.physicalPieceId], foreignColumns: [physicalPieces.id], name: "fo_piece_fk" }),
  foreignKey({ columns: [table.visualAssetId], foreignColumns: [visualAssets.id], name: "fo_asset_fk" }),
  index("forensic_observations_piece_idx").on(table.physicalPieceId, table.targetField),
]);

export const forensicDecisions = mysqlTable("forensic_decisions", {
  id: int("id").autoincrement().primaryKey(),
  physicalPieceId: int("physicalPieceId").notNull(),
  field: mysqlEnum("field", forensicField).notNull(),
  decision: mysqlEnum("decision", evidenceDecision).notNull().default("INCONCLUSIVE"),
  valueLiteral: text("valueLiteral"),
  rationale: text("rationale").notNull(),
  evidenceRef: varchar("evidenceRef", { length: 1024 }).notNull(),
  requiresPhysicalReview: boolean("requiresPhysicalReview").notNull().default(true),
  reviewedByOpenId: varchar("reviewedByOpenId", { length: 64 }),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  foreignKey({ columns: [table.physicalPieceId], foreignColumns: [physicalPieces.id], name: "fd_piece_fk" }),
  unique("forensic_decisions_piece_field_unique").on(table.physicalPieceId, table.field),
  index("forensic_decisions_status_idx").on(table.decision),
]);

export const workItems = mysqlTable("work_items", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 220 }).notNull(),
  description: text("description"),
  workstreamId: varchar("workstreamId", { length: 3 }).references(() => workstreams.id),
  status: mysqlEnum("status", workItemStatus).notNull().default("QUEUED"),
  priority: int("priority").notNull().default(100),
  isReadOnly: boolean("isReadOnly").notNull().default(true),
  requiresCanonicalEvidence: boolean("requiresCanonicalEvidence").notNull().default(true),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  assignedAt: timestamp("assignedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("work_items_status_priority_idx").on(table.status, table.priority),
  index("work_items_workstream_idx").on(table.workstreamId),
]);

export const workItemDependencies = mysqlTable("work_item_dependencies", {
  workItemId: int("workItemId").notNull().references(() => workItems.id),
  dependsOnWorkItemId: int("dependsOnWorkItemId").notNull().references(() => workItems.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.workItemId, table.dependsOnWorkItemId] })]);

export const incidents = mysqlTable("incidents", {
  id: int("id").autoincrement().primaryKey(),
  workstreamId: varchar("workstreamId", { length: 3 }).references(() => workstreams.id),
  workItemId: int("workItemId").references(() => workItems.id),
  severity: mysqlEnum("severity", ["BLOCKING", "CONDITIONING", "INFORMATIONAL"]).notNull(),
  status: mysqlEnum("status", incidentStatus).notNull().default("OPEN"),
  title: varchar("title", { length: 220 }).notNull(),
  detail: text("detail").notNull(),
  openedByOpenId: varchar("openedByOpenId", { length: 64 }).notNull(),
  resolvedByOpenId: varchar("resolvedByOpenId", { length: 64 }),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("incidents_status_idx").on(table.status)]);

export const auditEvents = mysqlTable("audit_events", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 96 }).notNull(),
  workstreamId: varchar("workstreamId", { length: 3 }).references(() => workstreams.id),
  workItemId: int("workItemId").references(() => workItems.id),
  incidentId: int("incidentId").references(() => incidents.id),
  actorOpenId: varchar("actorOpenId", { length: 64 }).notNull(),
  previousState: json("previousState"),
  nextState: json("nextState"),
  reason: text("reason").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("audit_events_workstream_idx").on(table.workstreamId, table.createdAt),
  index("audit_events_item_idx").on(table.workItemId, table.createdAt),
]);

export const reassignments = mysqlTable("reassignments", {
  id: int("id").autoincrement().primaryKey(),
  workItemId: int("workItemId").notNull().references(() => workItems.id),
  fromWorkstreamId: varchar("fromWorkstreamId", { length: 3 }).references(() => workstreams.id),
  toWorkstreamId: varchar("toWorkstreamId", { length: 3 }).notNull().references(() => workstreams.id),
  reason: text("reason").notNull(),
  actorOpenId: varchar("actorOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const verificationCache = mysqlTable("verification_cache", {
  id: int("id").autoincrement().primaryKey(),
  cacheKey: varchar("cacheKey", { length: 191 }).notNull().unique(),
  subjectType: varchar("subjectType", { length: 64 }).notNull(),
  subjectId: varchar("subjectId", { length: 128 }).notNull(),
  sourceUrl: varchar("sourceUrl", { length: 1024 }).notNull(),
  locale: varchar("locale", { length: 32 }).notNull(),
  contentSha256: varchar("contentSha256", { length: 64 }).notNull(),
  observedAt: timestamp("observedAt").notNull(),
  locator: text("locator").notNull(),
  cacheStatus: mysqlEnum("cacheStatus", cacheStatus).notNull().default("VALID"),
  invalidationReason: text("invalidationReason"),
  supersedesCacheKey: varchar("supersedesCacheKey", { length: 191 }),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  invalidatedAt: timestamp("invalidatedAt"),
}, table => [
  index("verification_cache_subject_idx").on(table.subjectType, table.subjectId),
  index("verification_cache_status_idx").on(table.cacheStatus),
]);

export const canonicalImports = mysqlTable("canonical_imports", {
  id: int("id").autoincrement().primaryKey(),
  manifestName: varchar("manifestName", { length: 191 }).notNull(),
  sourcePath: varchar("sourcePath", { length: 1024 }).notNull(),
  sourceSha256: varchar("sourceSha256", { length: 64 }).notNull(),
  sourceVersion: varchar("sourceVersion", { length: 128 }).notNull(),
  importStatus: mysqlEnum("importStatus", importStatus).notNull().default("PENDING"),
  entryCount: int("entryCount").notNull().default(0),
  verifiedByOpenId: varchar("verifiedByOpenId", { length: 64 }),
  verifiedAt: timestamp("verifiedAt"),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("canonical_imports_status_idx").on(table.importStatus)]);

export const canonicalImportEntries = mysqlTable("canonical_import_entries", {
  id: int("id").autoincrement().primaryKey(),
  canonicalImportId: int("canonicalImportId").notNull().references(() => canonicalImports.id),
  entryKey: varchar("entryKey", { length: 191 }).notNull(),
  entrySha256: varchar("entrySha256", { length: 64 }).notNull(),
  metadata: json("metadata").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("canonical_import_entries_import_idx").on(table.canonicalImportId)]);

export const canonicalVariants = mysqlTable("canonical_variants", {
  id: int("id").autoincrement().primaryKey(),
  canonicalImportId: int("canonicalImportId").notNull().references(() => canonicalImports.id),
  variantRef: varchar("variantRef", { length: 96 }).notNull().unique(),
  productCode: varchar("productCode", { length: 96 }),
  modelName: varchar("modelName", { length: 191 }),
  sourceLocator: varchar("sourceLocator", { length: 1024 }).notNull(),
  sourceSha256: varchar("sourceSha256", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["VERIFIED", "INCONCLUSIVE", "BLOCKED"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("canonical_variants_import_idx").on(table.canonicalImportId)]);

export const calibrationRuns = mysqlTable("calibration_runs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  sourceImportId: int("sourceImportId").references(() => canonicalImports.id),
  sourceSha256: varchar("sourceSha256", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["DRAFT", "VERIFIED", "REJECTED"]).notNull().default("DRAFT"),
  createdByOpenId: varchar("createdByOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  verifiedAt: timestamp("verifiedAt"),
});

export const calibrationMetrics = mysqlTable("calibration_metrics", {
  id: int("id").autoincrement().primaryKey(),
  calibrationRunId: int("calibrationRunId").notNull().references(() => calibrationRuns.id),
  metricKey: varchar("metricKey", { length: 128 }).notNull(),
  metricValue: varchar("metricValue", { length: 191 }).notNull(),
  evidenceRef: varchar("evidenceRef", { length: 1024 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("calibration_metrics_run_idx").on(table.calibrationRunId)]);
