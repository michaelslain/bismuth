// core/src/chatProviders/opencode/opencodeCli.ts
// The opencode CLI's major version, and the argv each Bismuth call needs under it.
//
// opencode 2 reshaped the CLI in ways that fail silently rather than loudly:
//   - every command that talks to opencode's server (`run`, `models`, `auth list`, `session
//     export`, `debug config`) connects to ONE per-user background service (`opencode serve
//     --service`, detached, PPID 1) unless it is passed `--standalone`. The service keeps the env
//     of whichever client started it, so a Bismuth turn's `OPENCODE_CONFIG_CONTENT` (local model),
//     its `chat` CLI stamp and its OS sandbox all either leak into the user's own opencode use or
//     are silently dropped when the user's service is already up. Tools run inside the server, so
//     a sandbox wrapped around the client alone confines nothing. `--standalone` gives each call a
//     private `serve --stdio` child that inherits the call's env and sandbox and exits with it.
//   - `export <id>` moved to `session export <id>`; `models --verbose` is gone; `run --command`
//     is gone and a leading `/name` is sent to the model verbatim; `debug config` lists config
//     sources rather than the resolved config and has no `--standalone`, so it always starts the
//     shared service.
//   - `run` shell-quotes a message argument containing whitespace before sending it, so the
//     model reads `"fix the bug"` with literal quotes; a message on stdin arrives verbatim.
//   - `opencode serve` speaks a new HTTP API (under `/api`, behind a password) that
//     @opencode-ai/sdk 1.x cannot drive; server mode drives it through opencodeV2Client.ts. Everything
//     below is the RUN-mode argv, which a v2 chat uses only in a restricted vault.

/** The major version out of `opencode --version` stdout (`opencode v2.0.32`, `1.18.4`), or null
 *  when nothing version-shaped is there. Pure. */
export function parseOpencodeMajor(versionOut: string): number | null {
    const m = versionOut.match(/(?:^|[^\w.])v?(\d+)\.\d+(?:\.\d+)?/)
    return m ? Number(m[1]) : null
}

/** True for an opencode whose CLI rides the shared background service (major 2 and up). An
 *  unknown version is treated as v1, the shape every call was written against. */
export function usesBackgroundService(major: number | null): boolean {
    return major !== null && major >= 2
}

/** The argv (after the binary) for one Bismuth opencode call under `major`, or null when that
 *  call has no safe equivalent there and must be skipped. v1 passes through unchanged. Pure. */
export function opencodeCliArgs(
    major: number | null,
    args: readonly string[],
): string[] | null {
    if (!usesBackgroundService(major)) return [...args]
    const [cmd, sub] = args
    if (cmd === 'run') {
        const i = args.indexOf('--command')
        // v2 has no non-interactive command invocation: a `/name` message reaches the model as
        // text, so a command turn is refused here rather than sent as a different prompt.
        if (i !== -1) return null
        return ['run', '--standalone', ...args.slice(1)]
    }
    if (cmd === 'models')
        return sub === '--verbose' ? null : ['models', '--standalone']
    if (cmd === 'auth' && sub === 'list')
        return ['auth', 'list', '--standalone']
    if (cmd === 'session') return [...args, '--standalone']
    if (cmd === 'export')
        return ['session', 'export', ...args.slice(1), '--standalone']
    if (cmd === 'debug' && sub === 'config') return null
    return [...args]
}

const majors = new Map<string, Promise<number | null>>()

/** The installed binary's major version, read once per binary path for the process's life. A
 *  failed or unparseable `--version` resolves null (treated as v1). */
export function opencodeMajor(bin: string): Promise<number | null> {
    let hit = majors.get(bin)
    if (!hit) {
        hit = (async () => {
            try {
                const proc = Bun.spawn([bin, '--version'], {
                    stdout: 'pipe',
                    stderr: 'ignore',
                })
                const timer = setTimeout(() => proc.kill(), 15000)
                const out = await new Response(
                    proc.stdout as ReadableStream,
                ).text()
                await proc.exited
                clearTimeout(timer)
                return parseOpencodeMajor(out)
            } catch {
                return null
            }
        })()
        majors.set(bin, hit)
    }
    return hit
}
