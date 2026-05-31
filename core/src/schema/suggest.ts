// core/src/schema/suggest.ts
import type { PropertyType, Schema } from "./types";

/** Property-key completions for an autocomplete prefix (case-insensitive). */
export function keySuggestions(schema: Schema, prefix: string): string[] {
  const p = prefix.toLowerCase();
  return Object.keys(schema)
    .filter((k) => k.toLowerCase().startsWith(p))
    .sort();
}

/**
 * Value completions for a given property type, filtered by prefix.
 * Enum-aware (drills through list items); case-insensitive filter; preserves
 * the configured value casing in the output.
 */
export function valueSuggestions(type: PropertyType, prefix: string): string[] {
  const p = prefix.toLowerCase();
  const candidates = enumerableValues(type);
  return candidates.filter((v) => v.toLowerCase().startsWith(p));
}

/** Concrete value set a type can complete to, or [] if open-ended. */
function enumerableValues(type: PropertyType): string[] {
  if (type === "boolean") return ["true", "false"];
  if (typeof type === "string") return [];
  if (type.kind === "enum") return type.values;
  if (type.kind === "list" && type.item) return enumerableValues(type.item);
  return [];
}
