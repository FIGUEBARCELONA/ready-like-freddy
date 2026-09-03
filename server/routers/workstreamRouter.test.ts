import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("../db", () => ({ getDb }));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "rlf-admin-test",
      email: "admin@example.invalid",
      name: "RLF Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const context = createAdminContext();
  return { ...context, user: { ...context.user!, role: "user" } };
}

async function expectFabricationRejection(run: () => Promise<unknown>) {
  await expect(run()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("Se rechaza contenido"),
  });
}

describe("workstream tRPC fabrication barrier", () => {
  beforeEach(() => {
    getDb.mockResolvedValue({});
  });

  it("rejects fabricated content in every operational mutation before database access", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const hash = "a".repeat(64);

    await expectFabricationRejection(() => caller.workstream.reservePartition({
      workstreamId: "F01",
      partitionType: "CUSTOM",
      partitionKey: "kb-documentary-scope",
      canonicalDescriptor: "placeholder descriptor for a fabricated scope",
      claims: [{ type: "MODEL_NAME", value: "Verified field" }],
    }));
    await expectFabricationRejection(() => caller.workstream.createWorkItem({
      reference: "RLF-WI-FAKE-001",
      title: "Factual task title",
      workstreamId: "F01",
      priority: 100,
      dependencyIds: [],
    }));
    await expectFabricationRejection(() => caller.workstream.createIncident({
      severity: "INFORMATIONAL",
      title: "Fake incident record",
      detail: "This text is sufficient to satisfy the field length.",
    }));
    await expectFabricationRejection(() => caller.workstream.registerVerification({
      cacheKey: "verified-cache-key",
      subjectType: "MODEL_NAME",
      subjectId: "M3600",
      fieldType: "MODEL_NAME",
      sourceUrl: "https://www.fredperry.com/us/polo-shirts/m3600.html",
      locale: "en-US",
      contentSha256: hash,
      observedAt: new Date(),
      locator: "placeholder locator",
    }));
    await expectFabricationRejection(() => caller.workstream.registerCanonicalManifest({
      manifestName: "Fake canonical manifest",
      sourcePath: "/home/ubuntu/rlf_review/RLF_EXECUTION_DOSSIER_20260821/data/real-path.csv",
      sourceSha256: hash,
      sourceVersion: "1.0",
      entries: [{ entryKey: "row-1", entrySha256: hash, metadata: {} }],
    }));
    await expectFabricationRejection(() => caller.workstream.createCalibrationRun({
      name: "Fake calibration",
      sourceImportId: 1,
      sourceSha256: hash,
      metrics: [{ metricKey: "rows", metricValue: "1", evidenceRef: "/canonical/source" }],
    }));
    await expectFabricationRejection(() => caller.workstream.reassignWorkItem({
      workItemId: 1,
      toWorkstreamId: "F02",
      reason: "placeholder reassignment rationale",
    }));
    await expectFabricationRejection(() => caller.workstream.updateWorkItemStatus({
      workItemId: 1,
      nextStatus: "READY",
      reason: "placeholder status rationale",
    }));
    await expectFabricationRejection(() => caller.workstream.invalidateVerification({
      cacheKey: "verified-cache-key",
      reason: "placeholder invalidation rationale",
    }));
    await expectFabricationRejection(() => caller.workstream.verifyCanonicalManifest({
      importId: 1,
      reason: "placeholder verification rationale",
    }));
    await expectFabricationRejection(() => caller.workstream.registerPhysicalPiece({
      pieceRef: "RLF-PIECE-FAKE-001",
      canonicalVariantRef: "RLF-GV-000036",
      canonicalVariantEvidenceRef: "data/canonical-variant.csv",
      sourceContext: "Factual source context for this physical piece.",
      custodyRef: "custody/real-intake-record",
      receivedAt: new Date(),
    }));
    await expectFabricationRejection(() => caller.workstream.registerVisualAsset({
      physicalPieceId: 1,
      role: "STD_PRIMARY",
      assetSha256: hash,
      storageKey: "storage/real-file.jpg",
      mimeType: "image/jpeg",
      pixelWidth: 1000,
      pixelHeight: 1000,
      capturedAt: new Date(),
      sourceProvenance: "placeholder visual source provenance",
      custodyRef: "custody/real-intake-record",
      rightsEvidenceRef: "rights/actual-review-record",
      scaleStatus: "DOCUMENTED",
      semanticEditStatus: "UNEDITED",
    }));
    await expectFabricationRejection(() => caller.workstream.reviewVisualRights({
      visualAssetId: 1,
      decision: "ACREDITED",
      reason: "placeholder rights review rationale",
    }));
    await expectFabricationRejection(() => caller.workstream.validateVisualManifest({
      physicalPieceId: 1,
      physicalReviewCompleted: true,
      reason: "placeholder physical review rationale",
    }));
  });

  it("reports accredited, pending and rejected visual assets as separate factual counts", async () => {
    const responses: unknown[][] = [
      [{ id: 1, pieceRef: "RLF-PIECE-001", canonicalVariantRef: "RLF-GV-000036", status: "DOCUMENTED" }],
      [{ id: 10, physicalPieceId: 1, manifestStatus: "INCOMPLETE" }],
      [
        { id: 100, physicalPieceId: 1, rightsStatus: "ACREDITED" },
        { id: 101, physicalPieceId: 1, rightsStatus: "UNKNOWN" },
        { id: 102, physicalPieceId: 1, rightsStatus: "REJECTED" },
      ],
      [],
      [],
    ];
    const db = {
      select: vi.fn(() => ({ from: () => ({ orderBy: async () => responses.shift() ?? [] }) })),
    };
    getDb.mockResolvedValue(db);

    const result = await appRouter.createCaller(createAdminContext()).workstream.visualOverview();

    expect(result.totalAssetCount).toBe(3);
    expect(result.accreditedAssetCount).toBe(1);
    expect(result.pendingAssetCount).toBe(1);
    expect(result.rejectedAssetCount).toBe(1);
    expect(result.summaries[0]?.assetCount).toBe(1);
    expect(result.summaries[0]?.quarantinedAssetCount).toBe(2);
  });

  it("blocks a physical piece when its exact canonical variant is not verified", async () => {
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })),
    };
    getDb.mockResolvedValue(db);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.workstream.registerPhysicalPiece({
      pieceRef: "RLF-PIECE-000001",
      canonicalVariantRef: "RLF-GV-000036",
      canonicalVariantEvidenceRef: "FP-OFF-PRODUCT-MS4710-910",
      sourceContext: "Physical intake recorded under the documentary custody protocol.",
      custodyRef: "custody/intake-000001",
      receivedAt: new Date(),
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects administrative mutations for an authenticated non-admin user", async () => {
    await expect(appRouter.createCaller(createUserContext()).workstream.initializeSlots()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("registers visual assets in rights quarantine and blocks an unaccredited manifest", async () => {
    const inserted: Record<string, unknown>[] = [];
    const responses = [
      [{ id: 1, pieceRef: "RLF-PIECE-000001" }],
      [{ id: 10, physicalPieceId: 1, manifestStatus: "INCOMPLETE" }],
      [{ role: "STD_PRIMARY", rightsStatus: "UNKNOWN", assetSha256: "a".repeat(64), semanticEditStatus: "UNEDITED" }],
      [{ id: 10, physicalPieceId: 1, manifestStatus: "INCOMPLETE" }],
      [{ role: "STD_PRIMARY", rightsStatus: "UNKNOWN", assetSha256: "a".repeat(64), semanticEditStatus: "UNEDITED" }],
    ];
    const db = {
      select: vi.fn(() => {
        const response = responses.shift() ?? [];
        const result = { limit: async () => response, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(response).then(resolve) };
        return { from: () => ({ where: () => result }) };
      }),
      insert: vi.fn(() => ({ values: async (value: Record<string, unknown>) => { inserted.push(value); } })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    getDb.mockResolvedValue(db);
    const caller = appRouter.createCaller(createAdminContext());
    const registered = await caller.workstream.registerVisualAsset({
      physicalPieceId: 1,
      role: "STD_PRIMARY",
      assetSha256: "a".repeat(64),
      storageKey: "storage/rights-reviewed-intake.jpg",
      mimeType: "image/jpeg",
      pixelWidth: 1200,
      pixelHeight: 1200,
      capturedAt: new Date(),
      sourceProvenance: "Capture received under the documented custody procedure.",
      custodyRef: "custody/intake-000001",
      rightsEvidenceRef: "rights/review-record-000001",
      scaleStatus: "DOCUMENTED",
      semanticEditStatus: "UNEDITED",
    });

    expect(inserted[0]).toMatchObject({ rightsStatus: "UNKNOWN" });
    expect(registered.manifestStatus).toBe("INCOMPLETE");
    await expect(caller.workstream.validateVisualManifest({
      physicalPieceId: 1,
      physicalReviewCompleted: true,
      reason: "Physical review completed with rights still awaiting accreditation.",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
