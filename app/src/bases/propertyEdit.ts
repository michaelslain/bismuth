// app/src/bases/propertyEdit.ts
// Pure logic behind the kanban card's editable meta chips (KanbanCard.tsx): which
// control a property's chip should open when clicked. Priority order:
//  0. the BASE'S OWN DECLARED type (`properties:` list-form `type:` on the base itself,
//     read via `core/src/bases/properties.ts` `propertyType()`) — #100/#101. Wins over
//     everything below for the kinds it has a dedicated editor for
//     (text/markdown/number/boolean/date/datetime/select/multiselect); a declared list/
//     link/formula has no dedicated editor YET (#102), so those fall through to the
//     heuristics below unchanged;
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
import type { BasePropertyType, NumberFormat } from "../../../core/src/bases/types";

// Duplicated (not imported) from renderValue.tsx's `bareName`, deliberately — that file is
// a .tsx (JSX/Icon imports), and this module must stay importable from a plain `bun test`
// .ts test without dragging in JSX (see columnLabel.ts for the same pattern/rationale).
// Exported so kanbanMeta.ts (also a plain .ts) can share it rather than re-duplicating —
// `metaVisible` needs the same registry-key lookup to detect a declared boolean property.
export function bareName(id: string): string {
  const dot = id.indexOf(".");
  return (dot >= 0 ? id.slice(dot + 1) : id).toLowerCase();
}

export type PropertyEditKind =
  | { kind: "text" }
  | { kind: "markdown" }
  | { kind: "number"; format?: NumberFormat; unit?: string }
  | { kind: "boolean" }
  | { kind: "date"; time?: boolean }
  | { kind: "select"; options: string[] }
  | { kind: "multiselect"; options: string[] }
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
 * for the "select from known values" fallback. `declaredType` (#100/#101) is the BASE's
 * own declared type for this property (`propertyType(config, id)`) — when present and its
 * `kind` has a dedicated editor, it wins outright; the remaining kinds (list/link/formula
 * — no editor yet) fall through to the heuristics below. A declared select/multiselect's
 * `options` list is passed through as-is — legacy tolerance (a stored value outside the
 * declared options) is handled downstream, in PropertyValueEditor, not here.
 */
export function propertyEditKind(
  id: string,
  value: unknown,
  schema: Schema,
  siblingValues: unknown[],
  declaredType?: BasePropertyType,
): PropertyEditKind {
  if (declaredType) {
    switch (declaredType.kind) {
      case "text": return { kind: "text" };
      case "markdown": return { kind: "markdown" };
      case "number": return { kind: "number", format: declaredType.number, unit: declaredType.unit };
      case "boolean": return { kind: "boolean" };
      case "date": return { kind: "date" };
      case "datetime": return { kind: "date", time: true };
      case "select": return { kind: "select", options: declaredType.options ?? [] };
      case "multiselect": return { kind: "multiselect", options: declaredType.options ?? [] };
      // list/link/formula: no dedicated editor yet — fall through.
    }
  }
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

// ── #101: select/multiselect editor helpers ───────────────────────────────────────────
//
// Pure logic behind PropertyValueEditor's select/multiselect branches, extracted here
// (rather than inlined in the .tsx) so it's testable without mounting Solid — same
// rationale as `distinctStrings` above.

/** Parse a stored value into the string array a multiselect editor edits: an array of
 *  strings as-is, a bare scalar as a single-element array, null/undefined/"" as empty. */
export function multiselectValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return [String(value)];
}

/** The declared options NOT already selected — what a multiselect's "+ Add" menu offers.
 *  A selected value outside `options` (legacy/hand-edited — #101 tolerance) simply has
 *  nowhere to go here; it stays selectable-for-removal via its own chip, not re-offered. */
export function multiselectAvailable(options: string[], selected: string[]): string[] {
  return options.filter((o) => !selected.includes(o));
}

/** What to COMMIT for a multiselect's next selected set: the array itself, or `null` when
 *  it's empty — matching the plain (undeclared) `tags` editor above, which also commits
 *  `null` on an empty list; `setMetaProperty` (KanbanView) reads `null` as "delete the
 *  key" rather than writing a bare `[]`. */
export function multiselectCommitValue(next: string[]): string[] | null {
  return next.length ? next : null;
}

/** The `Select` option list for a declared `select` property, current value first when
 *  it falls outside the declared set: a hand-edited or since-removed option still reads
 *  as the CURRENT selection instead of silently falling back to "(clear)" (#101 legacy
 *  tolerance). `current` is the empty string for "no value". */
export function selectOptionsWithCurrent(options: string[], current: string): string[] {
  if (current === "" || options.includes(current)) return options;
  return [current, ...options];
}
