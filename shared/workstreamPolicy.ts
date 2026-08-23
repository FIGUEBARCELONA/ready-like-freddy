import { createHash } from "node:crypto";

export const workItemStates = ["QUEUED", "WAITING_DEPENDENCY", "READY", "IN_PROGRESS", "BLOCKED", "COMPLETE", "FAILED", "CANCELLED"] as const;
export type WorkItemState = (typeof workItemStates)[number];

const allowedTransitions: Record<WorkItemState, WorkItemState[]> = {
  QUEUED: ["WAITING_DEPENDENCY", "READY", "BLOCKED", "CANCELLED"],
  WAITING_DEPENDENCY: ["READY", "BLOCKED", "CANCELLED"],
  READY: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETE", "FAILED", "BLOCKED"],
  BLOCKED: ["WAITING_DEPENDENCY", "READY", "CANCELLED"],
  COMPLETE: [],
  FAILED: ["READY", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: WorkItemState, to: WorkItemState) {
  return allowedTransitions[from].includes(to);
}

export function normalizeScope(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function fingerprint(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintScope(type: string, value: string) {
  return fingerprint(`${type}:${normalizeScope(value)}`);
}

export function fingerprintClaim(type: string, value: string) {
  return fingerprint(`${type}:${normalizeScope(value)}`);
}

export function isSha256(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function isOfficialFredPerryUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["fredperry.com", "www.fredperry.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function containsFabricationMarker(value: string) {
  return /\b(?:placeholder|fake|fictici[oa]|inventad[oa]|simulad[oa]|dummy|sample|example|ejemplo|dato de prueba|test data|tbd)\b/i.test(value);
}
