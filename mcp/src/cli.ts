// Bridge to the bismuth CLI (cli/src/index.ts). Spawns it via `bun run` and
// captures stdout/stderr/exit code. The CLI is a thin wrapper over @bismuth/core and
// reads BISMUTH_VAULT/BISMUTH_MEMORY from the environment, so we pass process.env through.
// Never throws — every failure mode resolves to a CliResult.

import { gateCliArgs } from '../../core/src/visibilityCliGate'

export interface CliResult {
    stdout: string
    stderr: string
    code: number
}

const DEFAULT_TIMEOUT_MS = 120_000
/** OCR and PDF conversion run Marker's models over every page: minutes on a long file. */
export const LONG_TIMEOUT_MS = 30 * 60_000
const LONG_COMMANDS = new Set(['ocr', 'pdf'])

/** PURE: how long a `bismuth_cli` call with these args may run before it is killed. */
export function cliTimeoutMs(args: string[]): number {
    return LONG_COMMANDS.has((args[0] ?? '').toLowerCase())
        ? LONG_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS
}

/**
 * Run the bismuth CLI. In a machine-wide install, BISMUTH_CLI points at the compiled
 * `bismuth` binary (no Bun/repo on disk), so we exec it directly; otherwise fall back to
 * `bun run <repoRoot>/cli/src/index.ts` (the dev repo). Inherits process.env (so
 * BISMUTH_VAULT/BISMUTH_MEMORY carry through) and this server's working directory, which is the
 * agent session's, so a flagless command resolves the vault the agent sits in, the same root the
 * gate above checked. On timeout the child is killed and the result has code -1 plus a stderr
 * note. Never throws.
 */
export async function runCli(
    repoRoot: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number },
): Promise<CliResult> {
    // The VISIBILITY GATE (core/src/visibilityCliGate.ts). Checked here, at the single chokepoint every MCP tool
    // spawns through, rather than at each call site — so a future tool cannot forget it. The vault
    // owner's own `bismuth` invocations are unaffected: they don't come through this MCP server.
    const gate = await gateCliArgs(args)
    if (!gate.allowed) {
        return {
            stdout: '',
            stderr:
                gate.reason ?? "Refused by the vault's visibility settings.",
            code: 1,
        }
    }

    const timeoutMs = opts?.timeoutMs ?? cliTimeoutMs(args)
    const cliBin = process.env.BISMUTH_CLI
    const cmd = cliBin
        ? [cliBin, ...args]
        : ['bun', 'run', `${repoRoot}/cli/src/index.ts`, ...args]

    try {
        const proc = Bun.spawn(cmd, {
            cwd: opts?.cwd ?? process.cwd(),
            // Anything this server spawns is an agent's hand: stamp BISMUTH_MCP_CHANNEL so the CLI
            // (doctor's isAgent) never mistakes it for the owner. Unset means some agent, the
            // same default as mcpChannel(); a spawner that declared a channel keeps it.
            env: {
                ...process.env,
                BISMUTH_MCP_CHANNEL:
                    process.env.BISMUTH_MCP_CHANNEL || 'daemon',
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })

        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            proc.kill()
        }, timeoutMs)

        try {
            const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ])

            if (timedOut) {
                const note = `cli timed out after ${timeoutMs}ms`
                return {
                    stdout,
                    stderr: stderr ? `${stderr}\n${note}` : note,
                    code: -1,
                }
            }

            return { stdout, stderr, code }
        } finally {
            clearTimeout(timer)
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { stdout: '', stderr: `failed to spawn cli: ${msg}`, code: -1 }
    }
}

/**
 * Format a CliResult into the single text blob the MCP tools return: stdout, then stderr,
 * then a `[exit N]` marker on failure. Used by the `bismuth_cli` tool. Falls back to "(no output)" when everything is empty.
 */
export function formatCliResult(r: CliResult): string {
    let text = r.stdout ?? ''
    if (r.code !== 0) {
        if (r.stderr) text += (text ? '\n' : '') + r.stderr
        text += `${text ? '\n' : ''}[exit ${r.code}]`
    } else if (r.stderr) {
        text += (text ? '\n' : '') + r.stderr
    }
    return text || '(no output)'
}

/**
 * Wrap a CLI result as an MCP tool result. `isError` is what an agent's control flow reads — a
 * non-zero exit (including a visibility refusal, which exits 1) MUST set it, or the agent treats
 * a refusal as a successful no-op.
 */
export function cliToolResult(r: CliResult): {
    content: { type: 'text'; text: string }[]
    isError: boolean
} {
    return {
        content: [{ type: 'text', text: formatCliResult(r) }],
        isError: r.code !== 0,
    }
}
