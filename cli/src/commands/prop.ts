// Frontmatter-property command group for the `bismuth` CLI.
// Mirrors core's POST /set-property and /delete-property: read the note, mutate a
// single frontmatter key (preserving YAML formatting), write it back. Mutating
// commands call core directly — the app's file watcher picks up the writes live.
//
// An image/PDF has no frontmatter of its own — its tags/properties live on its hidden
// companion note `<file>.<ext>.md` (core/src/fileKinds.ts's companionPathFor; e.g.
// `paper.pdf` -> `paper.pdf.md`), which the app already treats as that binary's property
// store. So both commands route a companionable path at its companion instead of the
// binary itself: `set` creates the companion on first use (its body starts empty), and
// `delete` on a companion that doesn't exist yet is a no-op success rather than an ENOENT
// — there is nothing to delete a key from. A plain note is untouched by any of this: same
// read/mutate/write it always did, same ENOENT if it doesn't exist.
//
// BOTH commands refuse outright — ENOENT, nothing written — when the BINARY ITSELF doesn't
// exist. Without this, `set` on a companionable path with a typo'd/missing binary would
// silently create an orphan `<file>.<ext>.md`: the tree only hides a companion while its
// binary is present, so that orphan would show up as an ordinary visible note (the same
// stray-note failure this command exists to stop agents from causing). `delete` refuses too,
// for symmetry with `set`, rather than treating a missing binary as "nothing to delete."
//
// `prop schema` and `prop check` read the named property schemas (core/src/schema/namedSchemas.ts):
// `schema` prints the effective schema one note follows, `check` validates one note, a folder or the
// whole vault against each note's own schema. `check` lists many notes, so the visibility gate
// classifies it as filtered (core/src/visibilityCliGate.ts) and it drops restricted notes itself.
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandMap } from '../types'
import { out, fail, parseValue, positionals, requireVault } from '../args'
import {
    setBaseConfigKey,
    deleteBaseConfigKey,
} from '../../../core/src/bases/baseFile'
import {
    readNote,
    writeNote,
    fileExists,
    listMarkdown,
} from '../../../core/src/files'
import { isCompanionable, companionPathFor } from '../../../core/src/fileKinds'
import { createError } from '../../../core/src/error'
import { parseFrontmatter } from '../../../core/src/frontmatter'
import { getPropertySchemaSet } from '../../../core/src/settings'
import {
    appliedSchemas,
    resolveNoteSchema,
    type PropertySchemaSet,
} from '../../../core/src/schema/namedSchemas'
import { validateDocument } from '../../../core/src/schema/validate'
import type { Diagnostic } from '../../../core/src/schema/types'
import {
    agentDenyEntries,
    filterByPath,
} from '../../../core/src/visibilityFilter'

function isEnoent(err: unknown): boolean {
    return (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
    )
}

/** The note a prop command actually reads/writes for `file` — its companion note when
 *  `file` is an image/PDF, else `file` itself. */
function propNotePath(file: string): string {
    return isCompanionable(file) ? companionPathFor(file) : file
}

/** One note's result from `prop check`. */
interface NoteCheck {
    path: string
    schemas: string[]
    diagnostics: (Omit<Diagnostic, 'path'> & { key: string })[]
}

/** Validate one note's frontmatter against its own effective schema. */
function checkNote(
    set: PropertySchemaSet,
    path: string,
    md: string,
    resolveLink: (target: string) => boolean,
): NoteCheck {
    const { data } = parseFrontmatter(md)
    const applied = appliedSchemas(set, path, data)
    const diags = validateDocument(data, resolveNoteSchema(set, path, data), {
        mode: 'frontmatter',
        ctx: { resolveLink },
    }).filter(d => d.severity !== 'info')
    for (const a of applied)
        if (!a.known)
            diags.push({
                path: [
                    a.source === 'folder'
                        ? `folderSchemas.${a.folder}`
                        : 'schema',
                ],
                severity: 'warning',
                message: `unknown schema: ${a.name}`,
            })
    return {
        path,
        schemas: applied.filter(a => a.known).map(a => a.name),
        diagnostics: diags.map(({ path: p, ...d }) => ({
            key: p.join('.'),
            ...d,
        })),
    }
}

/** `[[Target]]` / path resolution for `file` properties, over every note in the vault. */
function linkResolver(notes: string[]): (target: string) => boolean {
    const known = new Set<string>()
    for (const n of notes) {
        const id = n.replace(/\.md$/, '')
        known.add(id)
        known.add(n)
        known.add(id.split('/').pop() ?? id)
    }
    return target => known.has(target)
}

export const commands: CommandMap = {
    'prop schema': {
        summary:
            'Print the effective property schema a note follows: the vault registry plus the named schemas its folder binds and its own `schema:` key names',
        usage: '<file>',
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args)
            if (!file) fail('usage: prop schema <file>')
            const notePath = propNotePath(file)
            let md = ''
            try {
                md = await readNote(vault, notePath)
            } catch (err) {
                if (!isEnoent(err)) throw err
            }
            const set = await getPropertySchemaSet(vault)
            const { data } = parseFrontmatter(md)
            out(
                {
                    path: notePath,
                    schemas: appliedSchemas(set, notePath, data),
                    properties: resolveNoteSchema(set, notePath, data),
                },
                args,
            )
        },
    },
    'prop check': {
        summary:
            'Check notes against their property schemas (a note, a folder, or the whole vault); exits 1 when any note has an error',
        usage: '[<file|folder>]',
        run: async args => {
            const vault = requireVault(args)
            const [target] = positionals(args)
            const all = await listMarkdown(vault)
            const scope = (target ?? '').replace(/^\.\/|\/+$/g, '')
            let isDir = scope === ''
            if (!isDir) {
                try {
                    isDir = statSync(join(vault, scope)).isDirectory()
                } catch {
                    throw createError(
                        'ENOENT',
                        `prop check: no such file: ${scope}`,
                    )
                }
            }
            const picked = isDir
                ? all.filter(p => scope === '' || p.startsWith(`${scope}/`))
                : [propNotePath(scope)]
            const notes = filterByPath(
                picked,
                await agentDenyEntries(vault),
                p => p,
            )
            const set = await getPropertySchemaSet(vault)
            const resolveLink = linkResolver(all)
            const problems: NoteCheck[] = []
            for (const p of notes) {
                let md: string
                try {
                    md = await readNote(vault, p)
                } catch (err) {
                    if (isEnoent(err)) continue
                    throw err
                }
                const r = checkNote(set, p, md, resolveLink)
                if (r.diagnostics.length) problems.push(r)
            }
            const ok = !problems.some(r =>
                r.diagnostics.some(d => d.severity === 'error'),
            )
            out({ ok, checked: notes.length, problems }, args)
            process.exitCode = ok ? 0 : 1
        },
    },
    'prop set': {
        summary:
            "Set a frontmatter property on a note, or on an image/PDF's companion note (creating it if needed) — value parsed as JSON, else raw string",
        usage: '<file> <key> <value>',
        run: async args => {
            const vault = requireVault(args)
            const [file, key, value] = positionals(args)
            if (!file || !key) fail('usage: prop set <file> <key> <value>')
            if (value === undefined)
                fail('usage: prop set <file> <key> <value>')
            if (isCompanionable(file) && !fileExists(vault, file))
                throw createError('ENOENT', `prop set: no such file: ${file}`)
            const notePath = propNotePath(file)
            let md: string
            try {
                md = await readNote(vault, notePath)
            } catch (err) {
                if (isCompanionable(file) && isEnoent(err)) md = ''
                else throw err
            }
            const next = setBaseConfigKey(notePath, md, key, parseValue(value))
            await writeNote(vault, notePath, next)
            out({ ok: true, path: notePath }, args)
        },
    },
    'prop delete': {
        summary:
            "Delete a frontmatter property from a note, or from an image/PDF's companion note (a no-op if the companion doesn't exist yet)",
        usage: '<file> <key>',
        run: async args => {
            const vault = requireVault(args)
            const [file, key] = positionals(args)
            if (!file || !key) fail('usage: prop delete <file> <key>')
            if (isCompanionable(file) && !fileExists(vault, file))
                throw createError(
                    'ENOENT',
                    `prop delete: no such file: ${file}`,
                )
            const notePath = propNotePath(file)
            let md: string
            try {
                md = await readNote(vault, notePath)
            } catch (err) {
                if (isCompanionable(file) && isEnoent(err)) {
                    out({ ok: true }, args)
                    return
                }
                throw err
            }
            const next = deleteBaseConfigKey(notePath, md, key)
            await writeNote(vault, notePath, next)
            out({ ok: true, path: notePath }, args)
        },
    },
}
