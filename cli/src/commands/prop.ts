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
import type { CommandMap } from '../types'
import { out, fail, parseValue, positionals, requireVault } from '../args'
import {
    setFrontmatterKey,
    deleteFrontmatterKey,
} from '../../../core/src/frontmatter'
import { readNote, writeNote, fileExists } from '../../../core/src/files'
import { isCompanionable, companionPathFor } from '../../../core/src/fileKinds'
import { createError } from '../../../core/src/error'

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

export const commands: CommandMap = {
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
            const next = setFrontmatterKey(md, key, parseValue(value))
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
            const next = deleteFrontmatterKey(md, key)
            await writeNote(vault, notePath, next)
            out({ ok: true, path: notePath }, args)
        },
    },
}
