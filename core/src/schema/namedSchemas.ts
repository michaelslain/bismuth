// core/src/schema/namedSchemas.ts
// Named property schemas: `.settings` `schemas: {name: {key: type}}` declares reusable property
// sets, `folderSchemas: {folderPath: name | [names]}` binds them to every note under a folder, and a
// note opts in itself with a `schema: name` (or a list) frontmatter key. This module resolves the ONE
// effective Schema a given note is validated against. Pure — no I/O, no framework imports — so the
// editor linter, GET /schema?path=, `bismuth prop schema` and `bismuth prop check` share it.
import type { Schema, SchemaEntry } from './types'
import { BUILTIN_PROPERTIES, loadRegistry } from './registry'
import { parseList } from './coerce'

/** Everything needed to resolve any note's schema, as parsed from `.settings`. */
export interface PropertySchemaSet {
    /** The vault-wide registry (`properties:`) over the built-ins. Applies to every note. */
    properties: Schema
    /** Named schemas (`schemas:`), by name. */
    schemas: Record<string, Schema>
    /** Folder bindings (`folderSchemas:`): folder path → schema names, in declared order. */
    folderSchemas: Record<string, string[]>
}

/** Where one applied schema came from. */
export interface AppliedSchema {
    name: string
    /** `folder` = bound by `folderSchemas` (with the folder that bound it); `note` = the note's own
     *  `schema:` key. */
    source: 'folder' | 'note'
    folder?: string
    /** False when the name is not declared under `schemas:` — it contributes nothing. */
    known: boolean
}

/** The frontmatter key a note names its own schemas with. */
export const SCHEMA_KEY = 'schema'

const EMPTY_SET: PropertySchemaSet = {
    properties: { ...BUILTIN_PROPERTIES },
    schemas: {},
    folderSchemas: {},
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Strip slashes and a leading `./` so `Reading/Books/`, `/Reading/Books` and `./Reading/Books` all
 *  bind the same folder. */
export function normalizeFolder(folder: string): string {
    return folder
        .trim()
        .replace(/^\.\//, '')
        .replace(/^\/+|\/+$/g, '')
}

/** Schema names from a `schema:` value or a `folderSchemas` value: a string (comma-separated
 *  allowed) or a list. Anything else yields []. */
export function schemaNames(raw: unknown): string[] {
    if (typeof raw === 'string' || Array.isArray(raw))
        return parseList(raw)
            .map(s => s.trim())
            .filter(Boolean)
    return []
}

/** Parse the three `.settings` sections into a PropertySchemaSet. Tolerant: a missing or malformed
 *  section reads as empty, like loadRegistry. */
export function loadSchemaSet(
    settings: Record<string, unknown> | null | undefined,
): PropertySchemaSet {
    if (!settings) return structuredClone(EMPTY_SET)
    const schemas: Record<string, Schema> = {}
    if (isPlainObject(settings.schemas)) {
        for (const [name, raw] of Object.entries(settings.schemas))
            schemas[name] = loadRegistry(raw)
    }
    const folderSchemas: Record<string, string[]> = {}
    if (isPlainObject(settings.folderSchemas)) {
        for (const [folder, raw] of Object.entries(settings.folderSchemas)) {
            const key = normalizeFolder(folder)
            const names = schemaNames(raw)
            if (!names.length) continue
            folderSchemas[key] = [...(folderSchemas[key] ?? []), ...names]
        }
    }
    return {
        properties: {
            ...BUILTIN_PROPERTIES,
            ...loadRegistry(settings.properties),
        },
        schemas,
        folderSchemas,
    }
}

/** Ancestor folders of a file path, shallowest first (`a/b/c.md` → `a`, `a/b`). */
function ancestorFolders(path: string): string[] {
    const segs = path.split('/').filter(Boolean).slice(0, -1)
    return segs.map((_, i) => segs.slice(0, i + 1).join('/'))
}

/** A base note's frontmatter is the base's config, not properties — no named schema applies. */
function isBaseNote(frontmatter: Record<string, unknown>): boolean {
    return frontmatter.type === 'base'
}

/**
 * The schemas that apply to the note at `path`, in precedence order (later wins on a shared key):
 * folder bindings from the shallowest folder to the deepest, then the note's own `schema:` names.
 * A name listed twice keeps its last position.
 */
export function appliedSchemas(
    set: PropertySchemaSet,
    path: string,
    frontmatter: Record<string, unknown>,
): AppliedSchema[] {
    if (isBaseNote(frontmatter)) return []
    const out: AppliedSchema[] = []
    for (const folder of ancestorFolders(path)) {
        for (const name of set.folderSchemas[folder] ?? [])
            out.push({
                name,
                source: 'folder',
                folder,
                known: Object.hasOwn(set.schemas, name),
            })
    }
    for (const name of schemaNames(frontmatter[SCHEMA_KEY]))
        out.push({
            name,
            source: 'note',
            known: Object.hasOwn(set.schemas, name),
        })
    return out.filter((a, i) => out.findLastIndex(b => b.name === a.name) === i)
}

/** The `schema:` key's own declaration: a list of declared schema names, so autocomplete offers them
 *  and a typo is an error with did-you-mean suggestions. */
function schemaKeyEntry(set: PropertySchemaSet): SchemaEntry {
    return {
        type: {
            kind: 'list',
            item: { kind: 'enum', values: Object.keys(set.schemas) },
        },
        doc: 'Named property schemas (from `schemas:` in .settings) this note follows.',
    }
}

/**
 * The effective Schema for the note at `path` with the given (live) frontmatter: the vault-wide
 * registry, then every applied named schema in precedence order, then the `schema:` key itself.
 * `required` is honoured only from named schemas — the vault-wide registry's `required` stays
 * ignored in notes, since it would demand the key of every note in the vault.
 */
export function resolveNoteSchema(
    set: PropertySchemaSet,
    path: string,
    frontmatter: Record<string, unknown>,
): Schema {
    const schema: Schema = {}
    for (const [key, entry] of Object.entries(set.properties)) {
        const { required: _ignored, ...rest } = entry
        schema[key] = rest
    }
    for (const applied of appliedSchemas(set, path, frontmatter)) {
        if (!applied.known) continue
        Object.assign(schema, set.schemas[applied.name])
    }
    schema[SCHEMA_KEY] = schemaKeyEntry(set)
    return schema
}

/** True when any applied schema declares a `required` key — the editor uses it to report a missing
 *  key on a note that has no frontmatter block at all. */
export function hasRequired(schema: Schema): boolean {
    return Object.values(schema).some(e => e.required)
}

/** `folderSchemas` bindings that name an undeclared schema, for the `.settings` lint. */
export function unknownFolderBindings(
    set: PropertySchemaSet,
): { folder: string; name: string }[] {
    const out: { folder: string; name: string }[] = []
    for (const [folder, names] of Object.entries(set.folderSchemas))
        for (const name of names)
            if (!Object.hasOwn(set.schemas, name)) out.push({ folder, name })
    return out
}
