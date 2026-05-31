// core/src/schema/coerce.ts

/**
 * Normalize a value into a string list.
 * - string  -> comma-split ONLY (never on whitespace), each item trimmed, empties dropped
 * - array   -> passthrough, each element String()-ified and trimmed, empties dropped
 * - scalar  -> single-element array of its string form
 * - null/undefined -> []
 */
export function parseList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((s) => s.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [String(value)];
}

/** Strip a single leading '#' and surrounding whitespace from a raw tag. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, "").trim();
}
