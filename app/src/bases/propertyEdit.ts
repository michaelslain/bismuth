// app/src/bases/propertyEdit.ts
// Pure logic behind the kanban card's editable meta chips (KanbanCard.tsx): which
// control a property's chip should open when clicked. Priority order:
//  0. the BASE'S OWN DECLARED type (`properties:` list-form `type:` on the base itself,
//     read via `core/src/bases/properties.ts` `propertyType()`) — #100/#101. Wins over
//     everything below for the kinds it has a dedicated editor for
//     (text/markdown/number/boolean/date/datetime/select/multiselect); a declared list/
//     link has no dedicated editor yet, so those fall through to the heuristics below
//     unchanged. A declared `formula` property never reaches this dispatch's editor path
//     at all — its column id is the non-writable `formula.<name>` namespace (#102, see
//     `core/src/bases/query.ts` `declaredColumns`), so the caller's own `writableKey()`
//     check (kanbanMeta.ts) blocks opening any editor before `propertyEditKind` output
//     would even matter;
//  1. the vault-wide property registry (`properties:` in .settings — the same schema
//     the note editor's autocomplete/lint reads via propertyRegistry());
//  2. the current value's own runtime type — a frontmatter value is already typed by
//     the YAML parser (booleans/numbers/arrays parse natively; ISO date-like strings
//     are detected by shape since YAML itself keeps them as plain strings);
//  3. for a plain string with no declared type, a "select from known values" fallback
//     inferred from what the BOARD already uses for that property — so an undeclared
//     status/priority-like column still gets a picker instead of a raw text box, without
//     depending on an explicit per-base property schema (a separate concern).
import type { Schema } from '../../../core/src/schema/types'
import type {
    BasePropertyType,
    NumberFormat,
} from '../../../core/src/bases/types'
import { bareName } from './columnKinds'
import { numberEditValue, parseNumberEdit } from './numberFormat'

export type PropertyEditKind =
    | { kind: 'text' }
    | { kind: 'markdown' }
    | { kind: 'number'; format?: NumberFormat; unit?: string }
    | { kind: 'boolean' }
    | { kind: 'date'; time?: boolean }
    | { kind: 'select'; options: string[] }
    /** `tag`: the property is a tag column (`tags`/`tag`) — drawn in the tag look. */
    | { kind: 'multiselect'; options: string[]; tag?: boolean }
    /** An undeclared (or registry `list`) list of strings, edited as one comma-separated line.
     *  `tag`: a tag column (`tags`/`tag`) — drawn in the tag look and suggested vault tags. */
    | { kind: 'tags'; options: string[]; tag: boolean }
    /** A value no editor here can round-trip — a list holding numbers or links, or a comma
     *  inside a comma-separated value. Shown, never edited, so opening it cannot rewrite it. */
    | { kind: 'readonly' }

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// A "select from known values" fallback only pays off when the board actually has a
// small, reusable value set: too few (every row's value is unique) means the picker
// would just be friction over a text box, and too many means it's closer to free text.
const MIN_SELECT_VALUES = 2
const MAX_SELECT_VALUES = 8

/** Distinct, non-empty scalar values from a set of sibling values, as display strings,
 *  sorted for a stable menu order. Objects (links, tag arrays, etc.) are skipped — they
 *  aren't representable in a flat picker. */
export function distinctStrings(values: unknown[]): string[] {
    const set = new Set<string>()
    for (const v of values) {
        if (v == null || v === '') continue
        if (typeof v === 'object') continue
        set.add(String(v))
    }
    return [...set].sort()
}

/** The `options` a `tags` editor (ui/TagsField) suggests first: the distinct string values
 *  across every OTHER row's value for this property (flattening arrays) unioned with this row's
 *  OWN values, in first-seen order — not alphabetized like `distinctStrings`, since a tags menu
 *  reads better in the order the vault actually introduced each value. */
export function tagsOptions(value: unknown, siblingValues: unknown[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    const add = (v: unknown): void => {
        if (Array.isArray(v)) {
            for (const x of v) add(x)
            return
        }
        if (v == null || v === '' || typeof v === 'object') return
        const s = String(v)
        if (!seen.has(s)) {
            seen.add(s)
            out.push(s)
        }
    }
    for (const sv of siblingValues) add(sv)
    add(value)
    return out
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
            case 'text':
                return { kind: 'text' }
            case 'markdown':
                return { kind: 'markdown' }
            case 'number':
                return {
                    kind: 'number',
                    format: declaredType.number,
                    unit: declaredType.unit,
                }
            case 'boolean':
                return { kind: 'boolean' }
            case 'date':
                return { kind: 'date' }
            case 'datetime':
                return { kind: 'date', time: true }
            case 'select':
                return { kind: 'select', options: declaredType.options ?? [] }
            case 'multiselect':
                // A stored value holding a comma cannot survive the comma-separated field.
                return multiselectValues(value).some(v => v.includes(','))
                    ? { kind: 'readonly' }
                    : {
                          kind: 'multiselect',
                          options: declaredType.options ?? [],
                          ...(isTagName(id) ? { tag: true } : {}),
                      }
            // list/link/formula: no dedicated editor yet — fall through.
        }
    }
    const entry = schema[bareName(id)]
    if (entry) {
        const t = entry.type
        if (t === 'boolean') return { kind: 'boolean' }
        if (t === 'number') return { kind: 'number' }
        if (t === 'date') return { kind: 'date' }
        if (t === 'datetime') return { kind: 'date', time: true }
        if (typeof t === 'object' && t.kind === 'enum')
            return { kind: 'select', options: t.values }
        if (typeof t === 'object' && t.kind === 'list')
            return listEditKind(id, value, siblingValues)
    }
    // #103 migration default: a property NAMED `description` with no declared type (in
    // the base's own `properties:` nor the vault-wide registry) defaults to markdown —
    // the least-surprising choice, since every pre-#103 board treated it as a multiline
    // markdown slot. A base that wants something else just declares an explicit `type:`,
    // which (via `declaredType` above) always wins over this default.
    if (bareName(id) === 'description' && !entry) return { kind: 'markdown' }
    if (typeof value === 'boolean') return { kind: 'boolean' }
    if (typeof value === 'number') return { kind: 'number' }
    if (Array.isArray(value)) return listEditKind(id, value, siblingValues)
    if (typeof value === 'string') {
        if (ISO_DATETIME_RE.test(value)) return { kind: 'date', time: true }
        if (ISO_DATE_RE.test(value)) return { kind: 'date' }
    }
    const known = distinctStrings(siblingValues)
    if (known.length >= MIN_SELECT_VALUES && known.length <= MAX_SELECT_VALUES)
        return { kind: 'select', options: known }
    return { kind: 'text' }
}

/** A tag column: a property named `tags` or `tag`, however it is declared. */
function isTagName(id: string): boolean {
    const n = bareName(id)
    return n === 'tags' || n === 'tag'
}

/** How a list value is edited — see the `tags` / `readonly` kinds. Only a list of plain strings
 *  is editable, and a comma inside a value would make the comma-separated field split it, so
 *  that list is shown read-only too. */
function listEditKind(
    id: string,
    value: unknown,
    siblingValues: unknown[],
): PropertyEditKind {
    const list = Array.isArray(value) ? value : value == null ? [] : [value]
    if (list.some(v => typeof v !== 'string')) return { kind: 'readonly' }
    if ((list as string[]).some(v => v.includes(','))) return { kind: 'readonly' }
    const tag = isTagName(id)
    return { kind: 'tags', options: tagsOptions(value, siblingValues), tag }
}

// ── #101: select/multiselect editor helpers ───────────────────────────────────────────
//
// Pure logic behind PropertyValueEditor's select/multiselect branches, extracted here
// (rather than inlined in the .tsx) so it's testable without mounting Solid — same
// rationale as `distinctStrings` above.

/** Parse a stored value into the string array a multiselect editor edits: an array of
 *  strings as-is, a bare scalar as a single-element array, null/undefined/"" as empty. */
export function multiselectValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String)
    if (value == null || value === '') return []
    return [String(value)]
}

/** What to COMMIT for a multiselect's next selected set: the array itself, or `null` when
 *  it's empty — matching the plain (undeclared) `tags` editor above, which also commits
 *  `null` on an empty list; `setMetaProperty` (KanbanView) reads `null` as "delete the
 *  key" rather than writing a bare `[]`. */
export function multiselectCommitValue(next: string[]): string[] | null {
    return next.length ? next : null
}

/** The `Select` option list for a declared `select` property, current value first when
 *  it falls outside the declared set: a hand-edited or since-removed option still reads
 *  as the CURRENT selection instead of silently falling back to "(clear)" (#101 legacy
 *  tolerance). `current` is the empty string for "no value". */
export function selectOptionsWithCurrent(
    options: string[],
    current: string,
): string[] {
    if (current === '' || options.includes(current)) return options
    return [current, ...options]
}

// ── PropertyValueEditor's draft/commit/readonly helpers ─────────────────────────────────
// Pure, so they are testable without mounting Solid.

/** The text an editor box opens with for `value`: a number in
 *  EDIT space (percent ×100, see numberFormat.ts), anything else as its string. null → ''. */
export function propertyDraft(kind: PropertyEditKind, value: unknown): string {
    if (value == null) return ''
    if (kind.kind === 'number') {
        const n = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(n)
            ? String(numberEditValue(n, kind.format))
            : String(value)
    }
    return String(value)
}

/** What to commit for an editor's draft text: null when empty, the stored number for a `number`
 *  kind (unparseable input keeps the raw string rather than silently dropping the edit — the
 *  caller coerces through the declared type as a second pass), else the trimmed text. */
export function draftCommitValue(kind: PropertyEditKind, draft: string): unknown {
    const raw = draft.trim()
    if (raw === '') return null
    if (kind.kind === 'number') {
        const n = parseNumberEdit(raw, kind.format)
        return n === null ? raw : n
    }
    return raw
}

/** The display text of a value no editor can round-trip: a list joins with `, `, a link shows its
 *  display then its path, any other object its JSON. */
export function readonlyText(value: unknown): string {
    const show = (v: unknown): string =>
        v && typeof v === 'object'
            ? String(
                  (v as { display?: unknown }).display ??
                      (v as { path?: unknown }).path ??
                      JSON.stringify(v),
              )
            : String(v)
    return value == null
        ? ''
        : Array.isArray(value)
          ? value.map(show).join(', ')
          : show(value)
}

/** The `Select` choices for a declared `select` property: `(clear)` first, then the options with
 *  a stored value outside them kept as the current selection (see selectOptionsWithCurrent). */
export function selectChoices(
    options: string[],
    current: string,
): { value: string; label: string }[] {
    return [
        { value: '', label: '(clear)' },
        ...selectOptionsWithCurrent(options, current).map(v => ({
            value: v,
            label: v,
        })),
    ]
}
