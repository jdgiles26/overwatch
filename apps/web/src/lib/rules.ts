import type { AlertRule, Severity } from "@overwatch/schemas";

export type NewRuleDraft = Omit<AlertRule, "id"> & { id?: string };

export function newRule(): NewRuleDraft {
  return {
    label: "Severe weather near me",
    enabled: true,
    notify: {
      desktop: true,
      sound: true,
      soundKind: "chime",
      severityFloor: "moderate" satisfies Severity,
    },
    condition: {
      categories: ["weather"],
      minSeverity: "moderate" satisfies Severity,
      keywords: [],
      rateLimitMs: 60_000,
    },
  };
}
