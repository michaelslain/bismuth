// Puts the `bismuth` CLI on the PATH of every Claude Code session Bismuth starts (the chat, the
// daemon's sessions, `claude` typed in a terminal tab).
//
// Setting PATH in the spawn env is not enough: Claude Code's Bash tool replaces PATH with the one
// its snapshot of the user's login shell holds, so `~/.bismuth/bin` (and `~/.local/bin`, where the
// CLI symlink usually lands) vanish and the agent gets `command not found: bismuth`. Claude Code
// sources the file named by CLAUDE_ENV_FILE before every Bash command, after that snapshot, so a
// PATH line there survives. A CLAUDE_ENV_FILE the user already set is kept: it is passed on as
// BISMUTH_PREV_CLAUDE_ENV_FILE and sourced from ours.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bismuthHome } from './bismuthHome'
// The same directory as claudeWhich.ts's BISMUTH_BIN_DIR, resolved here so claudeWhich can import
// this module without a cycle.
const BISMUTH_BIN_DIR = bismuthHome('bin')

/** `~/.bismuth/agent-env.sh`, the file CLAUDE_ENV_FILE names. */
export function agentEnvFilePath(): string {
    return bismuthHome('agent-env.sh')
}

/** Single-quote `s` for a POSIX shell. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** PURE: the file's text, prepending `binDir` to PATH once, then sourcing the user's own env file. */
export function agentEnvFileBody(binDir: string = BISMUTH_BIN_DIR): string {
    const dir = shQuote(binDir)
    return [
        '# Written by Bismuth. Claude Code sources this before each Bash command of a session Bismuth',
        '# starts, so the bismuth CLI stays on PATH after Claude Code swaps in the login shell PATH.',
        `case ":$PATH:" in *:${dir}:*) ;; *) PATH=${dir}:"$PATH"; export PATH ;; esac`,
        '[ -n "$BISMUTH_PREV_CLAUDE_ENV_FILE" ] && [ -f "$BISMUTH_PREV_CLAUDE_ENV_FILE" ] && . "$BISMUTH_PREV_CLAUDE_ENV_FILE"',
        '',
    ].join('\n')
}

/** Write the env file when it is missing or stale; its path, or null when it cannot be written. */
export function ensureAgentEnvFile(
    path: string = agentEnvFilePath(),
): string | null {
    const body = agentEnvFileBody()
    try {
        if (existsSync(path) && readFileSync(path, 'utf8') === body) return path
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, body)
        return path
    } catch {
        return null
    }
}

/**
 * The env an agent session's shell needs to reach Bismuth, merged over `env` by the caller:
 * CLAUDE_ENV_FILE (the file above), the user's own previous CLAUDE_ENV_FILE carried as
 * BISMUTH_PREV_CLAUDE_ENV_FILE, BISMUTH_CLI when the installed CLI exists, and BISMUTH_VAULT when a
 * vault is given, so a flagless `bismuth` command and the visibility gate both resolve that vault.
 */
export function agentShellEnv(
    env: Record<string, string | undefined>,
    vault?: string,
): Record<string, string> {
    const out: Record<string, string> = {}
    const file = ensureAgentEnvFile()
    if (file) {
        out.CLAUDE_ENV_FILE = file
        const prev = env.CLAUDE_ENV_FILE
        if (prev && prev !== file) out.BISMUTH_PREV_CLAUDE_ENV_FILE = prev
        else if (env.BISMUTH_PREV_CLAUDE_ENV_FILE)
            out.BISMUTH_PREV_CLAUDE_ENV_FILE = env.BISMUTH_PREV_CLAUDE_ENV_FILE
    }
    const cli = join(BISMUTH_BIN_DIR, 'bismuth')
    if (!env.BISMUTH_CLI && existsSync(cli)) out.BISMUTH_CLI = cli
    if (vault) out.BISMUTH_VAULT = vault
    return out
}
