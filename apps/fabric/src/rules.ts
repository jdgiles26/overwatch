import crypto from "node:crypto";

/**
 * Normalize a rule id: treat empty-string as "no id provided" and mint a
 * fresh one. The web `newRule()` helper previously sent `id: ""` for drafts,
 * which slipped past `body.id ?? generate(...)` because `??` only substitutes
 * for null/undefined. Without this guard, every newly-created rule from the
 * UI would collide on `id = ""` and INSERT OR REPLACE in `db.upsertRule`
 * would overwrite the previous one.
 */
export function normalizeRuleId(input: unknown): string {
  if (typeof input === "string" && input.trim().length > 0) return input;
  return `rule_${crypto.randomBytes(5).toString("hex")}`;
}
