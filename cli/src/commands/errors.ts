// The `errors` command group: read the log of errors the app window threw and nothing caught
// (core/src/appErrors.ts). The window reports them to its core, which appends them to
// ~/.bismuth/logs/app-errors.jsonl; this reads that file directly, so no running app is needed.
import { resolve } from 'node:path'
import type { CommandMap } from '../types'
import { bool, fail, flag, optionalVault, out } from '../args'
import { clearAppErrors, readAppErrors } from '../../../core/src/appErrors'

function vaultFilter(args: string[]): string | undefined {
    if (bool(args, 'all')) return undefined
    const v = optionalVault(args)
    return v ? resolve(v) : undefined
}

export const commands: CommandMap = {
    errors: {
        summary:
            "List errors the app window threw and nothing caught, oldest first (this vault's, or every vault's with --all)",
        usage: '[--since <iso>] [--limit <n>] [--all] [--vault <dir>] [--pretty]',
        args: {
            flags: {
                since: 'value',
                limit: 'value',
                all: 'bool',
                vault: 'value',
                pretty: 'bool',
            },
        },
        run: args => {
            const rawLimit = flag(args, 'limit')
            const limit = rawLimit === undefined ? undefined : Number(rawLimit)
            if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
                fail('--limit takes a positive whole number')
            out(
                readAppErrors({
                    since: flag(args, 'since'),
                    vault: vaultFilter(args),
                    limit,
                }),
                args,
            )
        },
    },
    'errors clear': {
        summary: 'Empty the app error log (every vault\'s entries)',
        usage: '[--pretty]',
        args: { flags: { pretty: 'bool' } },
        run: args => {
            out({ cleared: clearAppErrors() }, args)
        },
    },
}
