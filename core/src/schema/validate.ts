// core/src/schema/validate.ts
import type {
  PropertyType,
  Schema,
  SchemaEntry,
  Diagnostic,
  ValidateContext,
  ValidateMode,
} from "./types";
import { extractWikilinks } from "../wikilinks";
import { parseList } from "./coerce";

/** Pull the link target from a value: "[[Target|Display]]" -> "Target", else the raw string. */
function linkTarget(value: string): string {
  const links = extractWikilinks(value);
  if (links.length > 0) return links[0];
  return value.trim();
}

/** Levenshtein distance for nearest-match enum suggestions. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n];
}

/** Closest configured value(s) to `value`, nearest first. */
function nearestEnum(values: string[], value: string): string[] {
  return [...values]
    .map((v) => ({ v, d: editDistance(v.toLowerCase(), value.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.v);
}

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
      case "icon": // a Lucide icon name OR an emoji — any string is valid, never flagged
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
      case "file": {
        if (!ctx?.resolveLink) return null;
        const target = typeof value === "string" ? linkTarget(value) : String(value);
        return ctx.resolveLink(target)
          ? null
          : warn(`"${target}" not found in vault`);
      }
    }
  }

  if (type.kind === "enum") {
    const str = String(value);
    const match = type.caseInsensitive
      ? type.values.some((v) => v.toLowerCase() === str.toLowerCase())
      : type.values.includes(str);
    if (match) return null;
    return err(
      `expected one of: ${type.values.join(", ")}`,
      nearestEnum(type.values, str).slice(0, 3),
    );
  }

  if (type.kind === "list") {
    const items = Array.isArray(value) ? value : parseList(value);
    if (!type.item) return null;
    for (let i = 0; i < items.length; i++) {
      const inner = validateValue(type.item, items[i], ctx);
      if (inner) return { ...inner, path: [String(i)] };
    }
    return null;
  }

  if (type.kind === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return err("expected an object");
    }
    const obj = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(type.fields)) {
      // validateEntry (not validateValue) so nested fields get soft min/max
      // range checks too — our settings.yaml nests every tunable under a section.
      const inner = validateEntry(entry, obj[key], ctx);
      if (inner) return { ...inner, path: [key, ...inner.path] };
    }
    return null;
  }

  return null;
}

/**
 * Validate a value against a full SchemaEntry: the type check first, then a
 * soft min/max range warning for numeric values. Returns null when clean.
 */
export function validateEntry(
  entry: SchemaEntry,
  value: unknown,
  ctx?: ValidateContext,
): Diagnostic | null {
  const typeDiag = validateValue(entry.type, value, ctx);
  if (typeDiag) return typeDiag;
  if (typeof value === "number") {
    if (entry.min !== undefined && value < entry.min) {
      return warn(`expected a value >= ${entry.min}`);
    }
    if (entry.max !== undefined && value > entry.max) {
      return warn(`expected a value <= ${entry.max}`);
    }
  }
  return null;
}

/**
 * Walk a parsed document object against a Schema and collect diagnostics.
 * - Known keys: validated via validateEntry (type + range).
 * - Unknown keys: info (frontmatter) / warning (settings).
 * - Missing required keys: ignored (frontmatter) / error (settings).
 */
export function validateDocument(
  parsed: unknown,
  schema: Schema,
  opts: { mode: ValidateMode; ctx?: ValidateContext },
): Diagnostic[] {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const obj = parsed as Record<string, unknown>;
  const out: Diagnostic[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const entry = schema[key];
    if (!entry) {
      out.push({
        path: [key],
        severity: opts.mode === "settings" ? "warning" : "info",
        message: `unknown property: ${key}`,
      });
      continue;
    }
    const diag = validateEntry(entry, value, opts.ctx);
    if (diag) out.push({ ...diag, path: [key, ...diag.path] });
  }

  if (opts.mode === "settings") {
    for (const [key, entry] of Object.entries(schema)) {
      if (!entry.required) continue;
      const v = obj[key];
      if (v === undefined || v === null) {
        out.push({
          path: [key],
          severity: "error",
          message: `missing required property: ${key}`,
        });
      }
    }

    // Toolbar items may carry either `command` (single) or `commands` (list); a
    // non-empty `commands` wins at runtime. Setting both is a no-op-prone mistake,
    // so warn (the generic field validator can't see across sibling fields).
    if (Array.isArray(obj.toolbar)) {
      obj.toolbar.forEach((item, i) => {
        if (
          item && typeof item === "object" &&
          "command" in item &&
          Array.isArray((item as { commands?: unknown }).commands) &&
          (item as { commands: unknown[] }).commands.length > 0
        ) {
          out.push({
            path: ["toolbar", String(i)],
            severity: "warning",
            message: "toolbar item sets both `command` and `commands`; `command` is ignored when `commands` is non-empty.",
          });
        }
      });
    }
  }

  return out;
}

