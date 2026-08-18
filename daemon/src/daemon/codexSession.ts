import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { VaultContext } from '../lib/config.ts'
import { whichBinary } from '../lib/claudeWhich.ts'
import { augmentPath } from '../lib/childEnv.ts'
import { writeAgentsMdBlock } from '../lib/agentsMd.ts'
import { parseFrontmatter } from '../lib/frontmatter.ts'
import type { BotResponse, SendOptions } from './session.ts'

/**
 * The Codex daemon backend: runs a vault's brain on OpenAI's Codex CLI, spawned DIRECTLY
 * (`codex exec`) as a subprocess — no `@openai/codex-sdk` dependency. Selected ONLY through
 * session.ts's resolveDaemonBackend, which refuses this backend outright for any vault with a
 * hidden note — see that function's docs for why (Codex has no equivalent of Claude's
 * managedSettings/sandbox/disallowedTools visibility-gate triple). This module never has to
 * re-check that itself; it trusts the caller already did.
 *
 * Why a direct subprocess and not `@openai/codex-sdk` (an earlier revision used it): the SDK
 * itself spawns a FRESH `codex exec` per call (verified by reading its compiled source before it
 * was removed) — there was never a lifecycle win from it — and its own binary resolution has NO
 * PATH lookup: absent an override it resolves a BUNDLED platform binary that measured ~310MB on
 * disk, an even worse fit here since this daemon compiles to a standalone binary of its own. This
 * module resolves the user's own `codex` the same way ../lib/claudeWhich.ts's whichBinary already
 * resolves every other CLI daemon/core drives, and pipes its NDJSON stdout by hand — the same
 * `codex exec --json`/`--experimental-json` event shape core/src/chatProviders/codex/protocol.ts's
 * translator consumes, just interpreted directly here since the daemon has no ChatFrame sink.
 *
 * Architecture mirrors session.ts's Claude path as closely as the two CLIs allow:
 *  - Per-vault conversation continuity: a durable thread id under
 *    <vault>/.daemon/codex-session-id (a SEPARATE file from Claude's session-id, so switching
 *    settings.daemon.backend back and forth never corrupts either backend's own continuity).
 *  - Per-call cwd: `--cd <vault root>`.
 *  - Per-call env: CODEX_HOME scoped to <vault>/.daemon/codex, so this vault's Codex session state
 *    (auth cache aside — Codex's login is machine-wide either way) never collides with another
 *    enabled vault's, or with the operator's own personal `~/.codex`. NOTE: pointing CODEX_HOME at
 *    a per-vault directory is NOT documented by OpenAI for multi-tenant use — it is an inference
 *    from CODEX_HOME's documented purpose (config/session root), not a live smoke test (no `codex`
 *    binary is installed in this sandbox). Verify this actually isolates auth/session state per
 *    vault before relying on it in production.
 *  - Persona/system-prompt equivalent: `codex exec` has no system-prompt flag (confirmed absent
 *    from the CLI's own config reference) — AGENTS.md is its designed channel instead (see
 *    docs/chat/backends.md's Surface 6). refreshIdentityAgentsMd below refreshes a managed block
 *    in the vault's AGENTS.md with the SAME identity.md-derived text buildSystemPrompt would have
 *    appended for Claude, gated on settings.codex.writeAgentsMd (VaultContext.codexWriteAgentsMd)
 *    — off means the Codex brain runs with NO persona/memory context at all, which is an honest
 *    degrade, not a silent one (logged once per send).
 *  - Headless: `--sandbox workspace-write` + approval_policy "never" — `codex exec` has no TTY to
 *    prompt on regardless, but this is explicit for determinism, matching the chat driver's
 *    identical posture.
 *  - `--json` vs `--experimental-json`: see core/src/chatProviders/codex/driver.ts's file header
 *    for the full rationale (both are real, evidenced flag spellings for the same NDJSON
 *    protocol — the CLI's own `--help` documents `--json`, the now-removed SDK's compiled source
 *    used `--experimental-json` internally). The working spelling is learned once per vault root
 *    and cached in {@link jsonFlagByRoot} for every later send.
 */

const DEFAULT_DAEMON_IDENTITY_FALLBACK =
    'A persistent personal-assistant daemon for this Bismuth vault, running continuously in the background.'

function codexThreadIdFile(ctx: VaultContext): string {
    return join(ctx.daemonDir, 'codex-session-id')
}

function codexHomeDir(ctx: VaultContext): string {
    return join(ctx.daemonDir, 'codex')
}

/**
 * The child env for one `codex exec` turn. Extracted from sendCodexMessage for the same reason
 * session.ts extracted buildQueryOptions: this env wiring is the part most likely to silently
 * regress, and a missing key here has no error, no log, and no visible symptom until an agent
 * has already written to the wrong place. Pure over its inputs.
 */
export function buildCodexEnv(
    ctx: VaultContext,
    codexHome: string,
    base: Record<string, string | undefined> = process.env as Record<
        string,
        string | undefined
    >,
): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
    env.PATH = augmentPath(base.PATH || '/usr/bin:/bin:/usr/sbin:/sbin')
    env.CODEX_HOME = codexHome
    // This vault's brain, named the same way session.ts's Claude path names it. UNCONDITIONAL and
    // never omitted: ctx.memoryDir/ctx.root are computed strings (lib/config.ts's vaultPaths), so
    // there is no "absent" case to degrade to — and the degrade is what bites. A cron session runs
    // with cwd = the VAULT ROOT, so an agent told to record a memory note with no memory location in
    // its environment resolves one relative to cwd and drops plain, frontmatter-less markdown into
    // <vault>/memory — orphaned notes in the user's vault, outside the memory graph and its git repo.
    // That is not hypothetical: it is the observed bug this injection closes.
    env.BISMUTH_MEMORY_DIR = ctx.memoryDir
    // Targets the bismuth CLI/MCP at THIS vault regardless of cwd, matching buildQueryOptions'
    // mcpServers env (mcp/src/memory.ts's memoryDir() falls back to resolving from BISMUTH_VAULT).
    env.BISMUTH_VAULT = ctx.root
    // Same signal session.ts's Claude path stamps — core/src/visibilityCliGate.ts's CLI-dispatch
    // gate reads this to tell the daemon's own `bismuth` invocations from the vault owner's.
    env.BISMUTH_AGENT_CHANNEL = 'daemon'
    return env
}

async function getCodexThreadId(
    ctx: VaultContext,
): Promise<string | undefined> {
    try {
        const id = (await readFile(codexThreadIdFile(ctx), 'utf-8')).trim()
        return id || undefined
    } catch {
        return undefined
    }
}

async function saveCodexThreadId(ctx: VaultContext, id: string): Promise<void> {
    try {
        await mkdir(ctx.daemonDir, { recursive: true })
        await writeFile(codexThreadIdFile(ctx), id, 'utf-8')
    } catch (err) {
        console.error(
            `[codexSession:${ctx.name}] Failed to persist Codex thread id:`,
            err,
        )
    }
}

/** Best-effort refresh of the vault's AGENTS.md managed block with this vault's identity — the
 *  closest honest equivalent to buildSystemPrompt's appendSystemPrompt for a backend with no
 *  system-prompt field. Gated by ctx.codexWriteAgentsMd (settings.codex.writeAgentsMd); logs once
 *  when off rather than failing silently, since a user who set daemon.backend:"codex" expecting a
 *  persona and forgot this second opt-in would otherwise get an unexplained blank slate. */
async function refreshIdentityAgentsMd(ctx: VaultContext): Promise<void> {
    if (!ctx.codexWriteAgentsMd) {
        console.error(
            `[codexSession:${ctx.name}] settings.codex.writeAgentsMd is off — running with no persona/memory context ` +
                `(Codex has no system-prompt flag; AGENTS.md is its only channel for this). Enable it to give this vault's ` +
                `Codex brain an identity.`,
        )
        return
    }
    let identity = DEFAULT_DAEMON_IDENTITY_FALLBACK
    try {
        const { body } = parseFrontmatter(
            await readFile(ctx.identityFile, 'utf-8'),
        )
        const trimmed = body.trim()
        if (trimmed) identity = trimmed
    } catch {
        // no identity.md (or unreadable) → fallback
    }
    const content = [
        `You are ${ctx.name}, a Bismuth daemon brain running on OpenAI Codex.`,
        '',
        identity,
        '',
        `Your memory graph is \`${ctx.memoryDir}\` (also in your environment as \`$BISMUTH_MEMORY_DIR\`).`,
        'Consult it before acting, and prefer linking to existing vault notes over duplicating them.',
        '',
        "Write memory notes ONLY through the bismuth `remember` tool — it is what stamps a note's",
        'frontmatter and files it into the memory graph. Your working directory is the VAULT, not the',
        'memory graph: never create a memory note at a path relative to your cwd, and in particular never',
        "in a `memory/` folder beside the user's notes — that is an orphaned directory in their vault, not",
        'the graph. If the `remember` tool is not available to you, say so and write nothing.',
    ].join('\n')
    writeAgentsMdBlock(ctx.root, content)
}

let codexBinPath: string | null | undefined
function codexBin(): string | null {
    if (codexBinPath === undefined) codexBinPath = whichBinary('codex')
    return codexBinPath
}

type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
const EFFORT_VALUES: readonly ModelReasoningEffort[] = [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
]
function asEffort(v: string | undefined): ModelReasoningEffort | undefined {
    return v && (EFFORT_VALUES as readonly string[]).includes(v)
        ? (v as ModelReasoningEffort)
        : undefined
}

type JsonFlag = '--json' | '--experimental-json'
function fallbackJsonFlag(flag: JsonFlag): JsonFlag {
    return flag === '--json' ? '--experimental-json' : '--json'
}
/** Which `--json`/`--experimental-json` spelling has worked for a given vault root, learned once
 *  and reused for every later send (see file header). */
const jsonFlagByRoot = new Map<string, JsonFlag>()

interface CodexExecArgsInput {
    jsonFlag: JsonFlag
    cwd: string
    model?: string
    effort?: ModelReasoningEffort
    threadId?: string
}

/** Mirrors core/src/chatProviders/codex/driver.ts's buildCodexExecArgs exactly (same rationale —
 *  see that file's header for why this exact flag order/shape is trusted, not guessed). */
function buildCodexExecArgs(a: CodexExecArgsInput): string[] {
    const args: string[] = ['exec', a.jsonFlag]
    if (a.model) args.push('--model', a.model)
    args.push('--sandbox', 'workspace-write')
    args.push('--cd', a.cwd)
    args.push('--skip-git-repo-check')
    if (a.effort) args.push('--config', `model_reasoning_effort="${a.effort}"`)
    args.push('--config', 'approval_policy="never"')
    if (a.threadId) args.push('resume', a.threadId)
    return args
}

interface CodexExecResult {
    resultText: string
    threadId: string
    exitCode: number
    parsedAnyLine: boolean
}

/** Spawn one `codex exec` turn and pump its NDJSON stdout, extracting just what the daemon needs
 *  (the thread id + the final agent_message text) — the same tolerant line-by-line JSON.parse the
 *  chat driver uses (core/src/chatProviders/codex/driver.ts), just without any ChatFrame emission. */
async function runCodexExec(
    bin: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    message: string,
    signal: AbortSignal | undefined,
    onThreadId: (id: string) => void,
): Promise<CodexExecResult> {
    const proc = Bun.spawn([bin, ...args], {
        cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env,
        signal,
    })
    try {
        const stdin = proc.stdin as import('bun').FileSink
        stdin.write(message)
        await stdin.end()
    } catch {
        /* pipe already gone — the exit code below reports the outcome */
    }

    let resultText = ''
    let threadId = ''
    let parsedAnyLine = false
    try {
        const decoder = new TextDecoder()
        let pending = ''
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
            pending += decoder.decode(chunk, { stream: true })
            let nl: number
            while ((nl = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, nl).trim()
                pending = pending.slice(nl + 1)
                if (!line) continue
                let ev: unknown
                try {
                    ev = JSON.parse(line)
                } catch {
                    continue // non-JSON noise on stdout — skip the line, never the send
                }
                parsedAnyLine = true
                if (ev && typeof ev === 'object') {
                    const e = ev as Record<string, unknown>
                    if (
                        e.type === 'thread.started' &&
                        typeof e.thread_id === 'string' &&
                        e.thread_id
                    ) {
                        threadId = e.thread_id
                        onThreadId(threadId)
                    } else if (
                        e.type === 'item.completed' &&
                        isRecord(e.item) &&
                        e.item.type === 'agent_message' &&
                        typeof e.item.text === 'string'
                    ) {
                        resultText = e.item.text
                    }
                }
            }
        }
    } catch {
        /* stream torn down mid-read (kill/abort/timeout) */
    }
    const exitCode = await proc.exited.catch(() => 1)
    return { resultText, threadId, exitCode, parsedAnyLine }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Send a message to a vault's Codex-backed brain. Mirrors session.ts's sendMessage signature/
 *  return shape exactly, so daemon/src/daemon/session.ts's dispatch can treat both backends
 *  uniformly. Assumes the caller (session.ts) has ALREADY passed this vault through
 *  resolveDaemonBackend — this function does not re-check the visibility gate itself. */
export async function sendCodexMessage(
    message: string,
    ctx: VaultContext,
    opts?: SendOptions,
): Promise<BotResponse> {
    const bin = codexBin()
    if (!bin) {
        throw new Error(
            'daemon backend "codex" is selected but the `codex` CLI was not found on PATH — install it ' +
                '(`npm i -g @openai/codex`) and run `codex` once to log in.',
        )
    }

    await refreshIdentityAgentsMd(ctx)

    const existingThreadId = opts?.newSession
        ? undefined
        : await getCodexThreadId(ctx)

    const codexHome = codexHomeDir(ctx)
    await mkdir(codexHome, { recursive: true }).catch(() => {})
    const env = buildCodexEnv(ctx, codexHome)

    const ac = opts?.abortController
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (ac && opts?.timeoutSecs && opts.timeoutSecs > 0) {
        timeoutId = setTimeout(() => {
            console.log(
                `[codexSession:${ctx.name}] Timeout reached (${opts.timeoutSecs}s), aborting session`,
            )
            ac.abort()
        }, opts.timeoutSecs * 1000)
    }

    let latestThreadId = existingThreadId ?? 'unknown'
    const onThreadId = (id: string) => {
        if (id !== latestThreadId) {
            latestThreadId = id
            void saveCodexThreadId(ctx, id)
        }
    }

    try {
        const jsonFlag = jsonFlagByRoot.get(ctx.root) ?? '--json'
        const args = buildCodexExecArgs({
            jsonFlag,
            cwd: ctx.root,
            model: opts?.model,
            effort: asEffort(opts?.effort),
            threadId: existingThreadId,
        })
        let result = await runCodexExec(
            bin,
            args,
            ctx.root,
            env,
            message,
            ac?.signal,
            onThreadId,
        )

        // Defensive fallback for the --json / --experimental-json spelling uncertainty (see file
        // header): zero parseable JSON lines + a non-zero exit is specifically "the flag was never
        // recognized" — retry ONCE with the other spelling. A genuine turn failure still emits at
        // least thread.started first, so this can't misfire on a real model/API error.
        if (
            !result.parsedAnyLine &&
            result.exitCode !== 0 &&
            !ac?.signal?.aborted
        ) {
            const retryFlag = fallbackJsonFlag(jsonFlag)
            const retryArgs = buildCodexExecArgs({
                jsonFlag: retryFlag,
                cwd: ctx.root,
                model: opts?.model,
                effort: asEffort(opts?.effort),
                threadId: existingThreadId,
            })
            const retryResult = await runCodexExec(
                bin,
                retryArgs,
                ctx.root,
                env,
                message,
                ac?.signal,
                onThreadId,
            )
            if (retryResult.parsedAnyLine)
                jsonFlagByRoot.set(ctx.root, retryFlag)
            result = retryResult
        }

        if (result.exitCode !== 0 && !ac?.signal?.aborted) {
            throw new Error(`codex exec exited with code ${result.exitCode}`)
        }
        return { result: result.resultText, sessionId: latestThreadId }
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }
}
