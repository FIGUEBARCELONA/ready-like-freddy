export const standardVisualRoles = ["STD_PRIMARY", "STD_REVERSE", "STD_PROFILE_A", "STD_PROFILE_B"] as const;
export const requiredMacroRoles = ["MACRO_BRAND", "MACRO_REGULATORY", "MACRO_IDENTIFIER", "MACRO_CONSTRUCTION", "MACRO_SIGNATURE"] as const;
export const optionalMacroRole = "MACRO_CONDITION" as const;
export const allVisualRoles = [...standardVisualRoles, ...requiredMacroRoles, optionalMacroRole] as const;
export type VisualRole = (typeof allVisualRoles)[number];
export type VisualRightsStatus = "ACREDITED" | "UNKNOWN" | "REJECTED";

export type VisualRecord = { role: VisualRole; rightsStatus: VisualRightsStatus; assetSha256: string; semanticEditStatus: "UNEDITED" | "DOCUMENTED_TRANSFORM" | "REJECTED" };

export function evaluateVisualManifest(records: VisualRecord[]) {
  const roles = new Set(records.map(record => record.role));
  const hashes = new Set(records.map(record => record.assetSha256));
  const standardComplete = standardVisualRoles.every(role => roles.has(role));
  const baseMacrosComplete = requiredMacroRoles.every(role => roles.has(role));
  const macroCount = records.filter(record => record.role.startsWith("MACRO_")).length;
  const allRightsAccredited = records.every(record => record.rightsStatus === "ACREDITED");
  const noRejectedTransform = records.every(record => record.semanticEditStatus !== "REJECTED");
  const noDuplicates = hashes.size === records.length && roles.size === records.length;
  const complete = standardComplete && baseMacrosComplete && (macroCount === 5 || macroCount === 6) && allRightsAccredited && noRejectedTransform && noDuplicates;
  return {
    standardViewCount: records.filter(record => record.role.startsWith("STD_")).length,
    macroCount,
    complete,
    blockReasons: [
      ...(standardComplete ? [] : ["Faltan una o más vistas estándar obligatorias." ]),
      ...(baseMacrosComplete ? [] : ["Faltan una o más macros canónicas obligatorias." ]),
      ...([5, 6].includes(macroCount) ? [] : ["El manifiesto requiere cinco o seis macros, no otra cantidad."]),
      ...(allRightsAccredited ? [] : ["Hay assets sin derechos acreditados."]),
      ...(noRejectedTransform ? [] : ["Hay assets con transformación rechazada."]),
      ...(noDuplicates ? [] : ["Hay roles o hashes visuales duplicados."]),
    ],
  };
}
