// `bismuth` CLI entry point. Dispatches by longest-match over the merged registry in
// ./registry.ts (resolveCommand: a three-word phrase "daemon cron toggle" first, then a two-word
// phrase "task toggle", then a one-word command "graph"). Each group is a thin wrapper over
// `@bismuth/core` functions — no running server required for the file-based commands (the app's
// vault watcher picks up writes live).
import { registry, resolveCommand } from './registry'
import { gateCliInvocation } from '../../core/src/visibilityCliGate'

// Width is computed once, over EVERY registered key, and reused by both the global listing and
// any group-scoped one below — so a group's entries print byte-identical to how they appear in
// the global listing (same padding), not re-flowed to a narrower column.
const ALL_KEYS = Object.keys(registry).sort()
const KEY_WIDTH = Math.max(...ALL_KEYS.map(k => k.length))

function printCommandList(keys: string[]): void {
    for (const k of keys) {
        const c = registry[k]
        const usage = c.usage ? ` ${c.usage}` : ''
        console.log(`  ${k.padEnd(KEY_WIDTH)}  ${c.summary}${usage}`)
    }
}

function printHelp(): void {
    console.log(
        'bismuth — control every aspect of a Bismuth vault from the shell\n',
    )
    console.log(
        'usage: bismuth <command> [args] [--vault <dir>] [--memory <dir>] [--pretty]\n',
    )
    printCommandList(ALL_KEYS)
    console.log(
        '\nmost commands need a vault: pass --vault <dir> or set BISMUTH_VAULT.',
    )
}

/** Every registered key that IS `group` (a bare one-word command) or that starts with
 *  `group ` (a multi-word phrase whose first word is `group`) — sorted, so `task` resolves
 *  to `task list`, `task toggle`, etc. Empty when `group` prefixes nothing. */
function groupKeys(group: string): string[] {
    return ALL_KEYS.filter(k => k === group || k.startsWith(`${group} `))
}

function printGroupHelp(group: string, keys: string[]): void {
    console.log(`bismuth ${group} — matching commands\n`)
    printCommandList(keys)
    console.log(
        '\nmost commands need a vault: pass --vault <dir> or set BISMUTH_VAULT.',
    )
}

const argv = Bun.argv.slice(2)

if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    process.exit(0)
}

// `help <group>` scopes the listing the same way `<group> --help` does below; `help` alone (or
// `help <word>` naming nothing) falls back to the full listing.
if (argv[0] === 'help') {
    const group = argv[1]
    const keys = group ? groupKeys(group) : []
    if (keys.length > 0) printGroupHelp(group!, keys)
    else printHelp()
    process.exit(0)
}

// Longest-match dispatch: prefer a three-word phrase, then two-word, then a single word.
const cmdKey = resolveCommand(argv)
const rest = cmdKey ? argv.slice(cmdKey.split(' ').length) : []

if (!cmdKey) {
    // The first word didn't match any registered command exactly — but if it's asking for
    // help on a GROUP (`bismuth task --help`/`-h`), and that word prefixes one or more
    // registered two/three-word commands, scope the listing to those instead of dumping
    // the entire registry. A word that prefixes nothing still falls through to the
    // unknown-command error below.
    if (argv[1] === '--help' || argv[1] === '-h') {
        const keys = groupKeys(argv[0])
        if (keys.length > 0) {
            printGroupHelp(argv[0], keys)
            process.exit(0)
        }
    }
    console.error(`unknown command: ${argv.slice(0, 3).join(' ')}\n`)
    printHelp()
    process.exit(1)
}

// The visibility gate (core/src/visibilityCliGate.ts), checked HERE — the one place every
// invocation of this binary passes through, no matter which command was matched or how it was
// invoked (a script, a subprocess, an agent's Bash tool). Keyed on BISMUTH_AGENT_CHANNEL, which is
// unset for the vault OWNER's own hand (their shell, a dev script, CI) — so this is a no-op for
// every interactive/headless use of the CLI today, and only refuses when Bismuth itself spawned the
// process that's running this command (see that file's header for the full design).
const gate = await gateCliInvocation(argv)
if (!gate.allowed) {
    console.error(gate.reason ?? "Refused by the vault's visibility settings.")
    process.exit(1)
}

try {
    await registry[cmdKey].run(rest)
} catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
}
