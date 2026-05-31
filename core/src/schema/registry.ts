// core/src/schema/registry.ts
import type { PropertyType, Schema, SchemaEntry } from "./types";

/** Always-known frontmatter properties (Obsidian-style), so notes never flag them
 *  as unknown even if the user hasn't listed them. User `properties:` entries with
 *  the same name override these. */
export const BUILTIN_PROPERTIES: Schema = {
  tags: { type: { kind: "list", item: "string" } },
  aliases: { type: { kind: "list", item: "string" } },
  cssclasses: { type: { kind: "list", item: "string" } },
  icon: { type: "icon", doc: 'Icon for this note (a Lucide icon name like "House" or an emoji).' },
};

const SCALAR_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "file",
  "icon",
]);

/** Parse a single type token (string or object form) into a PropertyType. */
function parseType(raw: unknown): PropertyType {
  if (typeof raw === "string") {
    return SCALAR_TYPES.has(raw) ? (raw as PropertyType) : "string";
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.enum)) {
      return {
        kind: "enum",
        values: obj.enum.map((v) => String(v)),
        ...(obj.caseInsensitive ? { caseInsensitive: true } : {}),
      };
    }
    if ("list" in obj) {
      const item = obj.list;
      return typeof item === "string" || (item && typeof item === "object")
        ? { kind: "list", item: parseType(item) }
        : { kind: "list" };
    }
    if (obj.fields && typeof obj.fields === "object") {
      return { kind: "object", fields: loadRegistry(obj.fields) };
    }
    if ("type" in obj) {
      return parseType(obj.type);
    }
  }
  return "string";
}

/**
 * Parse a `properties:` section into a Schema. Tolerant of unknown type
 * strings (fall back to "string") and of non-object input (yields {}).
 * Bare values ("date") and full entry objects ({type, required, ...}) both work.
 */
export function loadRegistry(raw: unknown): Schema {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const schema: Schema = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "type" in value) {
      const v = value as Record<string, unknown>;
      const entry: SchemaEntry = { type: parseType(v.type) };
      if (v.required !== undefined) entry.required = Boolean(v.required);
      if (v.default !== undefined) entry.default = v.default;
      if (typeof v.doc === "string") entry.doc = v.doc;
      if (typeof v.min === "number") entry.min = v.min;
      if (typeof v.max === "number") entry.max = v.max;
      schema[key] = entry;
    } else {
      schema[key] = { type: parseType(value) };
    }
  }
  return schema;
}
