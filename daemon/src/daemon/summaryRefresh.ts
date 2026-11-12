// Keeps a vault's note summaries fresh: before each incremental run that looks at the vault, the
// daemon runs `bismuth summary build --if-built --fast --jobs 1`, which summarises the notes whose
// text changed, one turn at a time on the fast tier of the vault's chat provider. `--if-built` makes
// it a no-op for a vault whose summaries were never built, so nothing is spent on a vault that never
// asked for them. The CLI owns the feature; the daemon only schedules it.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cliBin } from '../lib/bismuthPaths'

const run = promisify(execFile)
const running = new Set<string>()
/** A refresh outliving this is killed; the next run picks up where it stopped (each turn is saved). */
const REFRESH_TIMEOUT_MS = 30 * 60_000

export const REFRESH_ARGS = ['summary', 'build', '--if-built', '--fast', '--jobs', '1', '--json']

export type SummaryRefreshDeps = {
    cli?: () => string | undefined
    exec?: (file: string, args: string[]) => Promise<{ stdout: string }>
}

/** Refresh one vault's summaries; null when there is no CLI or a refresh for the vault is running. */
export async function refreshSummaries(root: string, deps: SummaryRefreshDeps = {}): Promise<string | null> {
    const cli = (deps.cli ?? cliBin)()
    if (!cli || running.has(root)) return null
    running.add(root)
    try {
        const exec = deps.exec ?? ((file, args) => run(file, args, { timeout: REFRESH_TIMEOUT_MS, maxBuffer: 1 << 20 }))
        const { stdout } = await exec(cli, [...REFRESH_ARGS, '--vault', root])
        return stdout.trim()
    } finally {
        running.delete(root)
    }
}
