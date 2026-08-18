// core/test/upgrade/schemaSnapshot.test.ts
//
// THE SILENT-UPGRADE TRIPWIRE.
//
// A setting's `default` is the value every user who never touched that key is running. Changing a
// default therefore changes behavior for the entire installed base on upgrade — invisibly, since
// nothing in their vault changed and nothing in the diff says "this alters existing users". The
// same goes for removing a key (settings stop taking effect), narrowing an enum (a saved value
// becomes invalid), or tightening min/max (a saved value gets clamped on next read).
//
// This test pins the whole schema surface — every path, type, default, bound and enum member — to
// a committed snapshot. It does NOT forbid changes. It forces them to be deliberate: you see the
// exact before/after in review, and you consciously re-bless it. This is exactly the class of
// change that has slipped through before (appearance.editorFontSize moved 11.5 → 13.5 and the
// only symptom was unrelated tests failing later).
//
// To re-bless after an INTENTIONAL schema change:
//     bun run test:bless-schema
// then read the resulting diff to the JSON fixture as part of your change.
import { test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_SCHEMA } from '../../src/schema/settingsSchema'
import type { Schema, PropertyType } from '../../src/schema/types'

const SNAPSHOT_PATH = join(
    import.meta.dir,
    '..',
    'fixtures',
    'upgrade',
    'settings-schema-snapshot.json',
)

/** A stable, diff-friendly description of a type: a bare name, or the shape that actually
 *  constrains what a saved value may be (enum members, list item type, path kind). */
function describeType(t: PropertyType): unknown {
    if (typeof t === 'string') return t
    if (t.kind === 'enum') return { kind: 'enum', values: [...t.values].sort() }
    if (t.kind === 'list')
        return { kind: 'list', item: t.item ? describeType(t.item) : null }
    if (t.kind === 'path')
        return { kind: 'path', only: t.only ?? null, scope: t.scope ?? null }
    return { kind: 'object' } // recursed into separately, so its fields are not inlined here
}

/** Flatten the schema to `{ "a.b.c": {type, default, min, max} }`. Sorted keys keep the JSON
 *  stable so a real change produces a minimal, readable diff. */
function flatten(
    schema: Schema,
    prefix: string[] = [],
    out: Record<string, unknown> = {},
): Record<string, unknown> {
    for (const key of Object.keys(schema).sort()) {
        const entry = schema[key]!
        const path = [...prefix, key].join('.')
        const isObj =
            typeof entry.type === 'object' &&
            (entry.type as { kind?: string }).kind === 'object'
        out[path] = {
            type: describeType(entry.type),
            // `default` is the load-bearing field for upgrade safety — record it even when undefined,
            // so ADDING a default to a previously-defaultless key also shows up as a diff.
            default: entry.default ?? null,
            min: entry.min ?? null,
            max: entry.max ?? null,
            required: entry.required ?? false,
        }
        if (isObj)
            flatten(
                (entry.type as { kind: 'object'; fields: Schema }).fields,
                [...prefix, key],
                out,
            )
    }
    return out
}

test('the settings schema matches its committed snapshot (defaults, types, bounds, enums)', () => {
    const current = flatten(SETTINGS_SCHEMA)

    if (process.env.BLESS_SCHEMA_SNAPSHOT === '1') {
        writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n')
        return
    }

    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<
        string,
        unknown
    >

    // Compare key SETS first: a bare added/removed path is the most common change and reads far
    // better as a list of paths than as a whole-object diff.
    const currentKeys = Object.keys(current).sort()
    const snapshotKeys = Object.keys(snapshot).sort()
    const added = currentKeys.filter(k => !snapshotKeys.includes(k))
    const removed = snapshotKeys.filter(k => !currentKeys.includes(k))

    expect({ added, removed }).toEqual({ added: [], removed: [] })

    // Then per-key values, so a changed default names the exact setting it belongs to.
    for (const key of currentKeys) {
        expect({ [key]: current[key] }).toEqual({ [key]: snapshot[key] })
    }
})

test('every non-object schema leaf carries a default, so an upgrading user is never left with undefined', () => {
    const flat = flatten(SETTINGS_SCHEMA)
    const missing: string[] = []
    for (const [path, meta] of Object.entries(flat)) {
        const m = meta as { type: unknown; default: unknown }
        const isObject =
            typeof m.type === 'object' &&
            (m.type as { kind?: string }).kind === 'object'
        // Maps that are legitimately empty until the user fills them (folderIcons, properties, …) are
        // declared as objects with no fields; those get `{}` from reconcile, not a scalar default.
        if (isObject) continue
        if (m.default === null) missing.push(path)
    }
    // A leaf with no default is a key reconcile seeds as `null` — the app then reads null for a
    // setting it expects to be typed. Anything landing here is either a real omission or a
    // deliberate nullable that belongs in this allow-list with a reason.
    const KNOWN_NULLABLE: string[] = []
    expect(missing.filter(p => !KNOWN_NULLABLE.includes(p))).toEqual([])
})
