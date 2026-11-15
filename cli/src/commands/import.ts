// `bismuth import obsidian`: convert an Obsidian vault into a Bismuth vault copy.
// Takes a folder, not --vault: the source is read-only and the result goes to --out.
import type { CommandMap } from '../types'
import { out, flag, bool, fail, positionals } from '../args'
import { importObsidian } from '../obsidianImport'

export const commands: CommandMap = {
    'import obsidian': {
        summary:
            'Convert an Obsidian vault into a Bismuth vault copy and write a conversion report listing what needs a decision',
        usage: '<folder> [--out <dir>] [--dry-run]',
        run: async args => {
            const [folder] = positionals(args)
            if (!folder) fail('<folder> required: the Obsidian vault to convert')
            const r = await importObsidian(folder, {
                out: flag(args, 'out'),
                dryRun: bool(args, 'dry-run'),
            })
            const { report, ...summary } = r
            out(bool(args, 'dry-run') ? { ...summary, report } : summary, args)
        },
    },
}
