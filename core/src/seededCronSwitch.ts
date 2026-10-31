// The on/off switch of a SEEDED cron (one the daemon writes into every vault, today only `dream`)
// is that cron file's own `enabled:` frontmatter line, the same switch the daemon page's cron menu
// and `bismuth daemon cron enable` flip. Three things make that work for a file the daemon writes
// and upgrades itself:
//
//   • the line is edited TEXTUALLY (withEnabled), never through a YAML round-trip, and the daemon's
//     stock-version hash ignores it (stripEnabled) — so flipping dream on or off never makes a stock
//     dream.md look user-edited, and the next stock upgrade still reaches it with the switch kept;
//   • a switch flipped before the daemon has written the file (the first-run intro's privacy slide)
//     is saved in `<home>/crons/.seed-enabled.json` and applied by the daemon when it writes the seed;
//   • a vault from before the switch moved here carries it as `daemon.dream` in `.settings`.
//     migrateDreamSwitch copies that value into dream.md (or the saved choice) once; core's
//     reconcileSettings calls it before pruning the key, and the daemon calls it before seeding,
//     because either process can reach an upgraded vault first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Crons the daemon seeds into every vault (daemon/src/daemon/defaultCrons.ts; a daemon test pins
 *  the two lists equal). Switching one whose file is missing saves the choice instead of failing. */
export const SEEDED_CRONS: readonly string[] = ['dream']

/** The saved switch choices for seeded crons whose file does not exist yet, under `<home>/crons`. */
export const PENDING_ENABLED_FILE = '.seed-enabled.json'

const FENCE = /^---\r?\n/

/** The frontmatter span of `md` as [start of the first key, index of the closing fence], or null. */
function frontmatterSpan(md: string): [number, number] | null {
    const open = md.match(FENCE)
    if (!open) return null
    const start = open[0].length
    const close = md.slice(start).search(/^---\r?$/m)
    if (close < 0) return null
    return [start, start + close]
}

const ENABLED_LINE = /^enabled:[^\n]*\n/m

/** `md` with its frontmatter `enabled:` line removed (unchanged when it has none): what the
 *  daemon hashes to tell a stock seed from a user-edited one. */
export function stripEnabled(md: string): string {
    const span = frontmatterSpan(md)
    if (!span) return md
    const [start, end] = span
    return md.slice(0, start) + md.slice(start, end).replace(ENABLED_LINE, '') + md.slice(end)
}

/** The value of `md`'s frontmatter `enabled:` line, or undefined when it has none. */
export function enabledLine(md: string): boolean | undefined {
    const span = frontmatterSpan(md)
    if (!span) return undefined
    const m = md.slice(span[0], span[1]).match(/^enabled:\s*(\S+)\s*$/m)
    if (!m) return undefined
    return m[1] === 'true'
}

/** `md` with its frontmatter `enabled:` line set to `on`: replaced in place, or added as the last
 *  frontmatter line. Every other byte is kept. A file with no frontmatter gets one. */
export function withEnabled(md: string, on: boolean): string {
    const line = `enabled: ${on}\n`
    const span = frontmatterSpan(md)
    if (!span) return `---\n${line}---\n${md}`
    const [start, end] = span
    const fm = md.slice(start, end)
    const next = ENABLED_LINE.test(fm) ? fm.replace(ENABLED_LINE, line) : fm + line
    return md.slice(0, start) + next + md.slice(end)
}

function pendingPath(home: string): string {
    return join(home, 'crons', PENDING_ENABLED_FILE)
}

function readPending(home: string): Record<string, boolean> {
    try {
        const parsed = JSON.parse(readFileSync(pendingPath(home), 'utf8'))
        if (!parsed || typeof parsed !== 'object') return {}
        const out: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(parsed))
            if (typeof v === 'boolean') out[k] = v
        return out
    } catch {
        return {}
    }
}

function writePending(home: string, pending: Record<string, boolean>): void {
    mkdirSync(join(home, 'crons'), { recursive: true })
    writeFileSync(pendingPath(home), JSON.stringify(pending, null, 2) + '\n')
}

/** Save the switch for a seeded cron whose file the daemon has not written yet (`home` is the
 *  vault's `.daemon` dir). The daemon applies it when it writes the seed. */
export function setPendingEnabled(home: string, name: string, on: boolean): void {
    writePending(home, { ...readPending(home), [name]: on })
}

/** The saved switch for `name`, or undefined. */
export function pendingEnabled(home: string, name: string): boolean | undefined {
    return readPending(home)[name]
}

/** Read and clear the saved switch for `name`; called by the daemon once the seed file exists. */
export function takePendingEnabled(home: string, name: string): boolean | undefined {
    const pending = readPending(home)
    if (!(name in pending)) return undefined
    const value = pending[name]
    delete pending[name]
    writePending(home, pending)
    return value
}

/**
 * Carry a vault's `daemon.dream` setting (`legacyOn`: whether it is exactly `true`) into the dream
 * cron's own switch. A dream.md with no `enabled:` line gets `enabled: <legacyOn>`, since until now
 * the setting alone held it on or off. With no dream.md yet, a `true` is saved for the daemon to
 * apply when it writes the file (a missing or `false` setting matches the stock `enabled: false`).
 * A dream.md that already has the line is left alone, so this runs once per vault. Returns whether
 * it wrote anything. `home` is the vault's `.daemon` dir.
 */
export function migrateDreamSwitch(home: string, legacyOn: boolean): boolean {
    const file = join(home, 'crons', 'dream.md')
    if (existsSync(file)) {
        let md: string
        try {
            md = readFileSync(file, 'utf8')
        } catch {
            return false
        }
        if (enabledLine(md) !== undefined) return false
        writeFileSync(file, withEnabled(md, legacyOn))
        return true
    }
    if (!legacyOn || pendingEnabled(home, 'dream') !== undefined) return false
    setPendingEnabled(home, 'dream', true)
    return true
}
