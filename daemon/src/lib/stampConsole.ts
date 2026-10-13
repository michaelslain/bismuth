// daemon/src/lib/stampConsole.ts — prefix every console line the running daemon prints with its
// ISO time. launchd/systemd append stdout and stderr to plain files with no time of their own,
// so without this a line in bismuth-daemon.stdout.log cannot be placed against the activity log.

type Method = 'log' | 'info' | 'warn' | 'error'

/** `[2026-10-12T22:43:36.534Z] ` for `now`. Exported for the test. */
export function stampPrefix(now: Date): string {
    return `[${now.toISOString()}] `
}

/** Wrap console.log/info/warn/error once for this process. Idempotent. */
export default function stampConsole(): void {
    const c = console as Console & { __stamped?: boolean }
    if (c.__stamped) return
    c.__stamped = true
    for (const m of ['log', 'info', 'warn', 'error'] as Method[]) {
        const original = console[m].bind(console)
        console[m] = (...args: unknown[]) => {
            if (typeof args[0] === 'string')
                original(stampPrefix(new Date()) + args[0], ...args.slice(1))
            else original(stampPrefix(new Date()).trimEnd(), ...args)
        }
    }
}
