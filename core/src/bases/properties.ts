// Pure helpers over a base's DECLARED property set (`properties:` in LIST form —
// see parse.ts normalizeProperties). Kept out of query.ts so the frontend (add-card
// seeding, property pickers) can consume the declaration without pulling the engine in.
import type {
  BaseConfig,
  BasePropertyKind,
  BasePropertyType,
  NumberFormat,
} from "./types";
import { NUMBER_FORMATS } from "./types";
import type { PropertyType as SchemaType } from "../schema/types";
import type { Diagnostic, ValidateContext } from "../schema/types";
import { validateValue } from "../schema/validate";
import { parseList } from "../schema/coerce";

/** Strip the writable `note.` namespace; other namespaces are handled by callers. */
function bareName(name: string): string {
  return name.startsWith("note.") ? name.slice(5) : name;
}

// ── Canonical base-property type model (#99) ─────────────────────────────────────────
//
// The parse + lookup + validation for a declared property's functional TYPE lives here
// (pure, frontend-importable) rather than in the engine, so #100's editor and #104's
// settings panel consume ONE module. `parseBasePropertyType` is called by parse.ts's
// `normalizePropertyDef`; `propertyType` is the read seam; `validatePropertyValue` /
// `coercePropertyValue` are the (not-yet-wired) value entry points.

/** Maps every accepted `type:` string — the canonical kinds AND the legacy informational
 *  vocabulary (checkbox→boolean, time→datetime) — onto a canonical kind. */
const KIND_ALIASES: Record<string, BasePropertyKind> = {
  text: "text",
  markdown: "markdown",
  number: "number",
  boolean: "boolean",
  checkbox: "boolean", // legacy
  select: "select",
  multiselect: "multiselect",
  date: "date",
  datetime: "datetime",
  time: "datetime",    // legacy
  list: "list",
  link: "link",
  formula: "formula",
};

/**
 * Parse a property entry object into the canonical `BasePropertyType`. Reads the entry's
 * `type` plus the sibling carrier keys the flat YAML form writes (`options`, `number`,
 * `unit`, `expr`). Returns undefined when NO `type` is declared (an untyped property).
 * A present-but-unrecognized `type` falls back to `{ kind: "text" }` (malformed-tolerant,
 * matching the codebase's YAML tolerance).
 */
export function parseBasePropertyType(o: Record<string, unknown>): BasePropertyType | undefined {
  if (o.type === undefined || o.type === null) return undefined;
  const raw = String(o.type).trim().toLowerCase();
  const kind = KIND_ALIASES[raw] ?? "text";
  const t: BasePropertyType = { kind };
  if (kind === "select" || kind === "multiselect") {
    const opts = Array.isArray(o.options)
      ? o.options.map((v) => String(v).trim()).filter((s) => s !== "")
      : [];
    if (opts.length) t.options = opts;
  }
  if (kind === "number") {
    const fmt = typeof o.number === "string" ? o.number.trim().toLowerCase() : undefined;
    if (fmt && (NUMBER_FORMATS as readonly string[]).includes(fmt)) t.number = fmt as NumberFormat;
    if (typeof o.unit === "string" && o.unit.trim() !== "") t.unit = o.unit.trim();
  }
  if (kind === "formula") {
    if (typeof o.expr === "string" && o.expr.trim() !== "") t.expr = o.expr.trim();
  }
  return t;
}

/**
 * The declared canonical type of a property, or undefined when the base doesn't declare
 * it (or declares it without a type). Accepts a bare (`priority`) or namespaced
 * (`note.priority`) name; matches the stored key exactly, then bare, then `note.`-prefixed.
 * This is the read seam #100's editor + #104's settings panel consume.
 */
export function propertyType(base: BaseConfig, name: string): BasePropertyType | undefined {
  const props = base.properties;
  if (!props) return undefined;
  const bare = bareName(name);
  const def = props[name] ?? props[bare] ?? props[`note.${bare}`];
  return def?.type;
}

/** Project a canonical base-property type onto the schema `PropertyType`, so value
 *  validation reuses `schema/validate.ts` (#99's validation entry point). Kinds without a
 *  meaningful input constraint (markdown/formula) validate as free strings. */
export function toSchemaType(t: BasePropertyType): SchemaType {
  switch (t.kind) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "date": return "date";
    case "datetime": return "datetime";
    case "link": return "file";
    case "select":
      return t.options && t.options.length ? { kind: "enum", values: t.options } : "string";
    case "multiselect":
      return {
        kind: "list",
        item: t.options && t.options.length ? { kind: "enum", values: t.options } : "string",
      };
    case "list": return { kind: "list", item: "string" };
    case "text":
    case "markdown":
    case "formula":
    default:
      return "string";
  }
}

/** Validate a value against a canonical base-property type. Returns null when valid (and
 *  for null/undefined). NOT yet wired into write paths — available for #100/#104. */
export function validatePropertyValue(
  t: BasePropertyType,
  value: unknown,
  ctx?: ValidateContext,
): Diagnostic | null {
  return validateValue(toSchemaType(t), value, ctx);
}

/** Coerce a raw (often string, from an input box) value into the canonical runtime shape
 *  for a base-property type: numbers to `number`, booleans to `boolean`, list/multiselect
 *  to a string array. Empty string coerces to null (a cleared value). Unrecognized/
 *  unparseable input is returned unchanged (tolerant). Pure; not yet wired into writes. */
export function coercePropertyValue(t: BasePropertyType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" && value.trim() === "") return null;
  switch (t.kind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : value;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const s = String(value).trim().toLowerCase();
      if (s === "true") return true;
      if (s === "false") return false;
      return value;
    }
    case "list":
    case "multiselect":
      return Array.isArray(value) ? value.map((v) => String(v)) : parseList(value);
    default:
      return value;
  }
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
