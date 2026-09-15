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
import type { CommandMap } from '../types'
import { out, fail, parseValue, positionals, requireVault } from '../args'
import {
    setFrontmatterKey,
    deleteFrontmatterKey,
} from '../../../core/src/frontmatter'
import { readNote, writeNote } from '../../../core/src/files'
import { isCompanionable, companionPathFor } from '../../../core/src/fileKinds'

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
