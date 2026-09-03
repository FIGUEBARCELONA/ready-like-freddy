import { describe, expect, it } from "vitest";
import { canTransition, containsFabricationMarker, fingerprintClaim, isOfficialFredPerryUrl, isSha256, normalizeScope } from "./workstreamPolicy";

describe("workstream fail-closed policy", () => {
  it("allows only recorded task state transitions", () => {
    expect(canTransition("READY", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETE")).toBe(true);
    expect(canTransition("COMPLETE", "READY")).toBe(false);
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
  });

  it("normalizes equivalent scope text and fingerprints it consistently", () => {
    expect(normalizeScope("  MS4716   Gold ")).toBe("ms4716 gold");
    expect(fingerprintClaim("PRODUCT_CODE", "MS4716")).toBe(fingerprintClaim("PRODUCT_CODE", "  ms4716  "));
    expect(fingerprintClaim("PRODUCT_CODE", "MS4716")).not.toBe(fingerprintClaim("MODEL_NAME", "MS4716"));
  });

  it("accepts only HTTPS official Fred Perry source URLs", () => {
    expect(isOfficialFredPerryUrl("https://www.fredperry.com/us/accessories/example.html")).toBe(true);
    expect(isOfficialFredPerryUrl("https://fredperry.com/jewellery")).toBe(true);
    expect(isOfficialFredPerryUrl("http://www.fredperry.com/us/item")).toBe(false);
    expect(isOfficialFredPerryUrl("https://fredperry.example/item")).toBe(false);
  });

  it("requires complete SHA-256 values", () => {
    expect(isSha256("a".repeat(64))).toBe(true);
    expect(isSha256("a".repeat(63))).toBe(false);
    expect(isSha256("z".repeat(64))).toBe(false);
  });

  it("rejects common markers of fabricated or placeholder content", () => {
    expect(containsFabricationMarker("Producto ejemplo para completar el campo")).toBe(true);
    expect(containsFabricationMarker("placeholder source URL")).toBe(true);
    expect(containsFabricationMarker("Laurel Wreath Necklace")).toBe(false);
  });
});
