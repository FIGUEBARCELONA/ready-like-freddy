import { describe, expect, it } from "vitest";
import { evaluateVisualManifest, type VisualRecord } from "./visualForensicPolicy";

const base: VisualRecord[] = [
  { role: "STD_PRIMARY", rightsStatus: "ACREDITED", assetSha256: "a".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "STD_REVERSE", rightsStatus: "ACREDITED", assetSha256: "b".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "STD_PROFILE_A", rightsStatus: "ACREDITED", assetSha256: "c".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "STD_PROFILE_B", rightsStatus: "ACREDITED", assetSha256: "d".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "MACRO_BRAND", rightsStatus: "ACREDITED", assetSha256: "e".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "MACRO_REGULATORY", rightsStatus: "ACREDITED", assetSha256: "f".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "MACRO_IDENTIFIER", rightsStatus: "ACREDITED", assetSha256: "1".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "MACRO_CONSTRUCTION", rightsStatus: "ACREDITED", assetSha256: "2".repeat(64), semanticEditStatus: "UNEDITED" },
  { role: "MACRO_SIGNATURE", rightsStatus: "ACREDITED", assetSha256: "3".repeat(64), semanticEditStatus: "UNEDITED" },
];

describe("visual forensic manifest policy", () => {
  it("accepts exactly four standard views and five accredited base macros", () => {
    const result = evaluateVisualManifest(base);
    expect(result.complete).toBe(true);
    expect(result.standardViewCount).toBe(4);
    expect(result.macroCount).toBe(5);
  });

  it("allows only the one optional condition macro as a sixth macro", () => {
    const result = evaluateVisualManifest([...base, { role: "MACRO_CONDITION", rightsStatus: "ACREDITED", assetSha256: "4".repeat(64), semanticEditStatus: "UNEDITED" }]);
    expect(result.complete).toBe(true);
    expect(result.macroCount).toBe(6);
  });

  it("blocks missing, unaccredited or duplicate evidence", () => {
    expect(evaluateVisualManifest(base.slice(1)).complete).toBe(false);
    expect(evaluateVisualManifest(base.map((asset, index) => index === 0 ? { ...asset, rightsStatus: "UNKNOWN" } : asset)).complete).toBe(false);
    expect(evaluateVisualManifest([...base, { ...base[0], role: "MACRO_CONDITION" }]).complete).toBe(false);
  });
});
