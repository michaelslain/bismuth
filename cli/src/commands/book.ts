// `bismuth book pages` — list a book base's page files: resolves the base's rows the way `base rows`
// does, then reads the page column. `bismuth transcribe` (commands/transcribe.ts) reads the pages.
import type { CommandMap } from '../types'
import { readNote } from '../../../core/src/files'
import { BOOLEAN_FLAGS, bool, fail, out, positionals, requireVault, today } from '../args'
import { createError } from '../../../core/src/error'
import { bookPageRefs } from '../../../core/src/bases/bookPages'
import { parseBaseFile } from '../../../core/src/bases/parse'
import { baseNameOf } from '../../../core/src/bases/baseFile'
import { resolveBaseRows } from '../../../core/src/bases/source'
import { runView } from '../../../core/src/bases/query'
import { readsDeniedBase } from './base'
import { agentDenyEntries, filterByPath, isDeniedPath } from '../../../core/src/visibilityFilter'
import { resolveBasePath } from '../baseResolve'

const BOOLS = [...BOOLEAN_FLAGS, 'json']

export const commands: CommandMap = {
    'book pages': {
        summary: "List a book base's page files in row order, one per line (--json: the page refs)",
        usage: '<base> [--json]',
        args: {
            positionals: ['base'],
            flags: { json: 'bool', vault: 'value', pretty: 'bool' },
        },
        run: async args => {
            const vault = requireVault(args)
            const [given] = positionals(args, BOOLS)
            if (!given) fail(`usage: book pages ${commands['book pages'].usage}`)
            const path = resolveBasePath(vault, given)
            const entries = await agentDenyEntries(vault)
            if (isDeniedPath(entries, path)) throw createError('ENOENT', `book: no such base: ${given}`)
            let text: string
            try {
                text = await readNote(vault, path)
            } catch {
                throw createError('ENOENT', `book: no such base: ${given}`)
            }
            const { config } = parseBaseFile(text, { name: baseNameOf(path), path })
            // A visible base whose source reads a hidden base yields no rows, as `base rows` does.
            const rows = (await readsDeniedBase(vault, config.source, entries))
                ? []
                : await resolveBaseRows(path, { root: vault, today: today() })
            const visibleRows = filterByPath(rows, entries, r => r.file.path)
            // The app lays pages out in the view's sorted order.
            const ordered = runView(config, visibleRows).groups.flatMap(g => g.rows)
            const refs = filterByPath(bookPageRefs(ordered, config.view), entries, r => r.file)
            if (bool(args, 'json')) out(refs, args)
            else for (const r of refs) console.log(r.file)
        },
    },
}
