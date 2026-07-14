// Pure logic behind BaseSettings.tsx's "Properties" section (#104) — lets a user DEFINE a
// base's own declared property set (the LIST-form `properties:` established by #99) from a
// GUI instead of hand-editing YAML. Kept out of the .tsx (same rationale as propertyEdit.ts /
// flashcardsQueue.ts): testable without mounting Solid.
//
// Round-trip contract: `seedPropertyRows` reads a base's CURRENT declared set into editable
// rows; `buildPropertiesYaml` assembles rows back into the exact flat shape
// `normalizeProperties`/`normalizePropertyDef` (core/src/bases/parse.ts) expect on read —
// `{name, type, hidden?, options?, number?, unit?, expr?, default?}` — so a save→reload
// round-trips losslessly. Only applies to bases that already declare (or are being taught to
// declare) their OWN property set via list form; a base using classic MAP-form `properties:`
// (per-property metadata only, no `declaredProperties`) seeds an EMPTY row set rather than
// surfacing entries it can't safely round-trip as a list (see BaseSettings.tsx save()).
import type { BaseConfig, BasePropertyKind, BasePropertyType, NumberFormat } from "../../../core/src/bases/types";
import { coercePropertyValue } from "../../../core/src/bases/properties";

/** One editable row in the Properties section. Flat (no nested `type` object) so every
 *  field binds directly to a form control; type-specific fields (`optionsText`/`number`/
 *  `unit`/`expr`) are only READ for the kinds that use them (see `buildPropertiesYaml`). */
export interface PropertyFormRow {
  name: string;
  kind: BasePropertyKind;
  hidden: boolean;
  /** select/multiselect choices, newline- or comma-separated (user-facing textarea). */
  optionsText: string;
  /** number-kind display format. */
  number: NumberFormat;
  /** number-kind unit/currency label. */
  unit: string;
  /** formula-kind expression. */
  expr: string;
  /** Raw default-value text; coerced to the property's kind on save. */
  defaultText: string;
}

/** A fresh blank row for "+ Add property", pre-seeded with a unique name. */
export function blankPropertyRow(existingNames: string[]): PropertyFormRow {
  return {
    name: nextPropertyName(existingNames),
    kind: "text",
    hidden: false,
    optionsText: "",
    number: "plain",
    unit: "",
    expr: "",
    defaultText: "",
  };
}

/** Default name for a newly added row, unique (case-insensitive) against `existing`:
 *  "property", then "property 2", "property 3", … */
export function nextPropertyName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has("property")) return "property";
  for (let i = 2; ; i++) {
    const candidate = `property ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Split an options textarea into a clean, ordered, deduped list — accepts either
 *  comma-separated or one-per-line input (or a mix) so users don't have to think about
 *  which delimiter to use. */
export function parsePropertyOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Seed the panel's editable rows from a base's OWN declared property set (list-form
 *  `properties:`), in declaration order. Empty when the base doesn't declare one. */
export function seedPropertyRows(config: BaseConfig): PropertyFormRow[] {
  const names = config.declaredProperties ?? [];
  return names.map((name) => {
    const def = config.properties?.[name];
    const t: BasePropertyType | undefined = def?.type;
    return {
      name,
      kind: t?.kind ?? "text",
      hidden: def?.hidden === true,
      optionsText: (t?.options ?? []).join("\n"),
      number: t?.number ?? "plain",
      unit: t?.unit ?? "",
      expr: t?.expr ?? "",
      defaultText: def?.default !== undefined ? String(def.default) : "",
    };
  });
}

/** Move `rows[index]` one slot toward `dir` (-1 up / +1 down), a no-op past either end.
 *  Reordering the rows drives card/table field order (`declaredColumns`, query.ts). */
export function moveRow<T>(rows: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (index < 0 || index >= rows.length || j < 0 || j >= rows.length) return rows;
  const arr = [...rows];
  [arr[index], arr[j]] = [arr[j], arr[index]];
  return arr;
}

/**
 * Assemble the panel's rows into the flat list-form `properties:` YAML value (an array of
 * plain objects) that `normalizeProperties` (parse.ts) parses back into
 * `declaredProperties` + `properties`. Blank-named rows are dropped (nothing to declare);
 * a duplicate name keeps the FIRST occurrence (matching parse.ts's own dedup rule) so the
 * panel can't silently produce a base that reads back with fewer properties than it shows.
 */
export function buildPropertiesYaml(rows: PropertyFormRow[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const entry: Record<string, unknown> = { name, type: row.kind };
    if (row.hidden) entry.hidden = true;

    if (row.kind === "select" || row.kind === "multiselect") {
      const opts = parsePropertyOptions(row.optionsText);
      if (opts.length) entry.options = opts;
    }
    if (row.kind === "number") {
      entry.number = row.number;
      if (row.unit.trim()) entry.unit = row.unit.trim();
    }
    if (row.kind === "formula") {
      // A formula property is computed, never seeded/stored (declaredDefaults skips it) —
      // a default would be silently ignored downstream, so don't even offer/write one.
      if (row.expr.trim()) entry.expr = row.expr.trim();
    } else if (row.defaultText.trim()) {
      entry.default = coercePropertyValue({ kind: row.kind }, row.defaultText.trim());
    }
    out.push(entry);
  }
  return out;
}
