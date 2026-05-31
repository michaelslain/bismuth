// core/src/schema/validate.ts
import type {
  PropertyType,
  Schema,
  Diagnostic,
  ValidateContext,
  ValidateMode,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when y-m-d is a real calendar date (e.g. rejects 2026-02-30). */
function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function err(message: string, suggestions?: string[]): Diagnostic {
  return { path: [], severity: "error", message, suggestions };
}

function warn(message: string, suggestions?: string[]): Diagnostic {
  return { path: [], severity: "warning", message, suggestions };
}

/**
 * Validate a single value against a property type.
 * Returns null when valid. The returned Diagnostic always has path:[]; the
 * caller (validateDocument) fills in the real path.
 * null/undefined is ALWAYS valid here (the required check lives in validateDocument).
 */
export function validateValue(
  type: PropertyType,
  value: unknown,
  ctx?: ValidateContext,
): Diagnostic | null {
  if (value === null || value === undefined) return null;

  if (typeof type === "string") {
    switch (type) {
      case "string":
        return null;
      case "number":
        return typeof value === "number" && !Number.isNaN(value)
          ? null
          : err("expected a number");
      case "boolean":
        return typeof value === "boolean" ? null : err("expected true or false");
      case "date": {
        if (value instanceof Date) {
          return Number.isNaN(value.getTime())
            ? err("expected a date (YYYY-MM-DD)")
            : null;
        }
        if (typeof value === "string" && DATE_RE.test(value)) {
          const [y, m, d] = value.split("-").map(Number);
          if (isRealCalendarDate(y, m, d)) return null;
        }
        return err("expected a date (YYYY-MM-DD)");
      }
      case "datetime": {
        if (value instanceof Date) {
          return Number.isNaN(value.getTime())
            ? err("expected a date-time (ISO-8601)")
            : null;
        }
        if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
          return null;
        }
        return err("expected a date-time (ISO-8601)");
      }
      case "file":
        // handled in a later task
        return null;
    }
  }

  // Object/enum/list compound types handled in later tasks.
  return null;
}

// validateDocument is implemented in a later task.
export function validateDocument(
  parsed: unknown,
  schema: Schema,
  opts: { mode: ValidateMode; ctx?: ValidateContext },
): Diagnostic[] {
  void parsed;
  void schema;
  void opts;
  return [];
}

export { err, warn };
