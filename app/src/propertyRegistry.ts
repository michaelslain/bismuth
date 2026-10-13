// app/src/propertyRegistry.ts
// Solid store holding the vault's property schemas: the vault-wide registry (`properties:` in
// `.settings`), the named `schemas:` and their `folderSchemas:` bindings. Hydrated from
// GET /property-schemas and refreshed when an SSE change touches `.settings`. Read by yamlSchema's
// linter + autocomplete sources (per note, via noteSchemaFor) and by Bases' typed editors.
import { createSignal, createRoot } from 'solid-js'
import { api } from './api'
import { isSettingsPath } from '../../core/src/changeClassifier'
import { FRONTMATTER_REGEX, parseFrontmatter } from '../../core/src/frontmatter'
import {
    loadSchemaSet,
    resolveNoteSchema,
    type PropertySchemaSet,
} from '../../core/src/schema/namedSchemas'
import type { Schema } from '../../core/src/schema/types'
import type { Row } from '../../core/src/bases/types'

// Seed with the built-ins so consumers never deref undefined before the first fetch resolves.
const [schemaSet, setSchemaSet] = createSignal<PropertySchemaSet>(
    loadSchemaSet(null),
)

/** Accessor for the whole schema set. */
export const propertySchemas: () => PropertySchemaSet = schemaSet

/** Accessor for the vault-wide registry (built-ins + `properties:`), for callers with no note. */
export const propertyRegistry: () => Schema = () => schemaSet().properties

/** Replace the schema set — the hydration path below, and the seam a story uses to show a note
 *  under a named schema without a server. */
export function setPropertySchemas(set: PropertySchemaSet): void {
    setSchemaSet(set)
}

/** The effective schema for the note at `path` given its (live) frontmatter — the vault registry,
 *  the folder-bound schemas and the note's own `schema:` names (core/src/schema/namedSchemas.ts). */
export function noteSchemaFor(
    path: string,
    frontmatter: Record<string, unknown>,
): Schema {
    return resolveNoteSchema(schemaSet(), path, frontmatter)
}

/** The schema a Bases row's typed editors read: the note's own effective schema for a note row,
 *  the vault registry for a row stored inside a base file (it is not a note, so no folder binding
 *  or `schema:` key covers it). */
export function rowSchema(row: Row): Schema {
    return row.index === undefined && row.file.path.endsWith('.md')
        ? noteSchemaFor(row.file.path, row.note)
        : schemaSet().properties
}

// One-entry memo: the editor asks on every lint pass and completion keystroke, and the
// frontmatter text rarely changes between them.
let memo: {
    set: PropertySchemaSet
    path: string
    doc: string
    schema: Schema
} | null = null

/** noteSchemaFor, reading the frontmatter from a whole note's text. */
export function noteSchemaForText(path: string, doc: string): Schema {
    const set = schemaSet()
    const fmText = doc.match(FRONTMATTER_REGEX)?.[0] ?? ''
    if (memo && memo.set === set && memo.path === path && memo.doc === fmText)
        return memo.schema
    const schema = resolveNoteSchema(set, path, parseFrontmatter(doc).data)
    memo = { set, path, doc: fmText, schema }
    return schema
}

/** Fetch /property-schemas and replace the set. Swallows network errors (keeps last good). */
export async function refreshPropertyRegistry(): Promise<void> {
    try {
        const set = await api.propertySchemas()
        if (set && typeof set.properties === 'object') setSchemaSet(set)
    } catch {
        // network hiccup — keep the last good set
    }
}

/** Whether an SSE change should re-hydrate the registry. Empty `paths` means "extent unknown"
 *  (initial snapshot or the fallback poll), so refresh to be safe. Pure so it is unit-testable
 *  without Solid's effect scheduling. */
export function registryShouldRefresh(paths: string[]): boolean {
    return paths.length === 0 || paths.some(isSettingsPath)
}

// Hydrate + wire SSE only in a real browser. `serverVersion` constructs a global
// EventSource at import time, which doesn't exist under `bun test` (headless) — so
// we gate the whole side-effecting block (and defer that import) behind that check.
// We also require `window`: some test files stub a bare global EventSource to import
// browser modules headlessly, and that stub alone must not kick off hydration (it
// would pollute this module-level singleton for other test files). A real browser
// always has both. The seeded accessors above are always available regardless.
if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
    createRoot(() => {
        void refreshPropertyRegistry()
        let lastSeen = -1
        void (async () => {
            const { lastChange } = await import('./serverVersion')
            const { createEffect } = await import('solid-js')
            // Re-hydrate whenever an SSE change reports .settings (where the registry
            // lives), or when paths are unknown (initial snapshot / fallback poll → assume
            // it may have changed).
            createEffect(() => {
                const c = lastChange()
                if (c.version === lastSeen) return
                lastSeen = c.version
                if (registryShouldRefresh(c.paths)) {
                    void refreshPropertyRegistry()
                }
            })
        })()
    })
}
