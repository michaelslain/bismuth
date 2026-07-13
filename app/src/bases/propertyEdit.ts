// app/src/bases/propertyEdit.ts
// Pure logic behind the kanban card's editable meta chips (KanbanCard.tsx): which
// control a property's chip should open when clicked. Priority order:
//  1. the vault-wide property registry (`properties:` in .settings — the same schema
//     the note editor's autocomplete/lint reads via propertyRegistry());
//  2. the current value's own runtime type — a frontmatter value is already typed by
//     the YAML parser (booleans/numbers/arrays parse natively; ISO date-like strings
//     are detected by shape since YAML itself keeps them as plain strings);
//  3. for a plain string with no declared type, a "select from known values" fallback
//     inferred from what the BOARD already uses for that property — so an undeclared
//     status/priority-like column still gets a picker instead of a raw text box, without
//     depending on an explicit per-base property schema (a separate concern).
import type { Schema } from "../../../core/src/schema/types";

// Duplicated (not imported) from renderValue.tsx's `bareName`, deliberately — that file is
// a .tsx (JSX/Icon imports), and this module must stay importable from a plain `bun test`
// .ts test without dragging in JSX (see columnLabel.ts for the same pattern/rationale).
function bareName(id: string): string {
  const dot = id.indexOf(".");
  return (dot >= 0 ? id.slice(dot + 1) : id).toLowerCase();
}

export type PropertyEditKind =
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date"; time?: boolean }
  | { kind: "select"; options: string[] }
  | { kind: "tags" };

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A "select from known values" fallback only pays off when the board actually has a
// small, reusable value set: too few (every row's value is unique) means the picker
// would just be friction over a text box, and too many means it's closer to free text.
const MIN_SELECT_VALUES = 2;
const MAX_SELECT_VALUES = 8;

/** Distinct, non-empty scalar values from a set of sibling values, as display strings,
 *  sorted for a stable menu order. Objects (links, tag arrays, etc.) are skipped — they
 *  aren't representable in a flat picker. */
export function distinctStrings(values: unknown[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v == null || v === "") continue;
    if (typeof v === "object") continue;
    set.add(String(v));
  }
  return [...set].sort();
}

/**
 * Which editor a property chip should open for `value` on this row. `siblingValues` is
 * every OTHER row's raw value for the same property (across the whole board), used only
 * for the "select from known values" fallback.
 */
export function propertyEditKind(id: string, value: unknown, schema: Schema, siblingValues: unknown[]): PropertyEditKind {
  const entry = schema[bareName(id)];
  if (entry) {
    const t = entry.type;
    if (t === "boolean") return { kind: "boolean" };
    if (t === "number") return { kind: "number" };
    if (t === "date") return { kind: "date" };
    if (t === "datetime") return { kind: "date", time: true };
    if (typeof t === "object" && t.kind === "enum") return { kind: "select", options: t.values };
    if (typeof t === "object" && t.kind === "list") return { kind: "tags" };
  }
  if (typeof value === "boolean") return { kind: "boolean" };
  if (typeof value === "number") return { kind: "number" };
  if (Array.isArray(value)) return { kind: "tags" };
  if (typeof value === "string") {
    if (ISO_DATETIME_RE.test(value)) return { kind: "date", time: true };
    if (ISO_DATE_RE.test(value)) return { kind: "date" };
  }
  const known = distinctStrings(siblingValues);
  if (known.length >= MIN_SELECT_VALUES && known.length <= MAX_SELECT_VALUES) return { kind: "select", options: known };
  return { kind: "text" };
}
