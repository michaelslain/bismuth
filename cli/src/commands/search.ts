// Search + replace command group for the `bismuth` CLI.
// Wraps core's searchVault (ranked full-text search) and replaceInVault
// (vault-wide find-and-replace). Mutating commands call core directly — the
// app's file watcher picks up the writes live.
import type { CommandMap } from '../types'
import { bool, flag, out, positionals, requireVault } from '../args'
import { searchVault, type SearchOpts } from '../../../core/src/search'
import { replaceInVault } from '../../../core/src/replace'
import { commitVault, snapshotMessage } from '../../../core/src/backup'

/** Build SearchOpts from the shared --regex/--case/--word boolean flags. */
function buildOpts(args: string[]): SearchOpts {
    return {
        regex: bool(args, 'regex'),
        caseSensitive: bool(args, 'case'),
        wholeWord: bool(args, 'word'),
    }
}

export const commands: CommandMap = {
    search: {
        summary: 'Search the vault for a query (ranked, with match snippets)',
        usage: '<query> [--regex] [--case] [--word]',
        run: async args => {
            const vault = requireVault(args)
            const [query] = positionals(args)
            const results = await searchVault(
                vault,
                query ?? '',
                buildOpts(args),
            )
            out(results, args)
        },
    },
    replace: {
        summary:
            'Replace a query with a replacement across the vault (or one note with --scope)',
        usage: '<query> <replacement> [--scope <path>] [--no-snapshot] [--regex] [--case] [--word]',
        run: async args => {
            const vault = requireVault(args)
            const [query, replacement] = positionals(args)
            const scope = flag(args, 'scope') ?? 'vault'
            if (!bool(args, 'no-snapshot')) {
                // Best-effort, matching POST /replace's pre-replace snapshot: a vault that isn't a git
                // repo yet (or any other git failure) must not block the replace itself.
                try {
                    await commitVault(vault, snapshotMessage())
                } catch (e) {
                    console.error(
                        `warning: snapshot failed, proceeding without an undo point: ${(e as Error).message}`,
                    )
                }
            }
            const result = await replaceInVault(
                vault,
                query ?? '',
                replacement ?? '',
                buildOpts(args),
                scope,
            )
            out(result, args)
        },
    },
}
