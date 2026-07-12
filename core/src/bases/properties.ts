// Pure helpers over a base's DECLARED property set (`properties:` in LIST form —
// see parse.ts normalizeProperties). Kept out of query.ts so the frontend (add-card
// seeding, property pickers) can consume the declaration without pulling the engine in.
import type { BaseConfig } from "./types";

/** Strip the writable `note.` namespace; other namespaces are handled by callers. */
function bareName(name: string): string {
  return name.startsWith("note.") ? name.slice(5) : name;
}

/** Whether a declared property name is a writable frontmatter key (not file./formula./this.). */
function isWritable(name: string): boolean {
  return !name.startsWith("file.") && !name.startsWith("formula.") && !name.startsWith("this.");
}

/**
 * Frontmatter to seed onto a NEW card/row of a base that declares its properties:
 * every declared writable property with an explicit `default` (false/0/"" count — only
 * a missing default is skipped), keyed by the bare frontmatter name. `exclude` drops
 * keys the caller writes itself (e.g. the kanban status/description/order keys); it is
 * matched against the bare name. Returns {} when the base declares no properties.
 */
export function declaredDefaults(base: BaseConfig, exclude?: ReadonlySet<string>): Record<string, unknown> {
  const names = base.declaredProperties;
  if (!names || !base.properties) return {};
  const out: Record<string, unknown> = {};
  for (const name of names) {
    if (!isWritable(name)) continue;
    const key = bareName(name);
    if (exclude?.has(key)) continue;
    const def = base.properties[name]?.default;
    if (def !== undefined) out[key] = def;
  }
  return out;
}

/**
 * The declared property names as BARE frontmatter keys (declaration order), for UIs that
 * enumerate a base's fields (column pickers, sort/group dropdowns). Empty when the base
 * doesn't declare its own properties (map-form metadata or no `properties:` at all).
 */
export function declaredPropertyKeys(base: BaseConfig): string[] {
  return (base.declaredProperties ?? []).map(bareName);
}
