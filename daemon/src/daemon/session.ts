import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parseFrontmatter } from '../lib/frontmatter.ts'
import type { VaultContext } from '../lib/config.ts'
import { isOwner } from '../lib/owner.ts'
import { whichClaude } from '../lib/claudeWhich.ts'
import { augmentPath } from '../lib/childEnv.ts'
import {
    buildDenyPaths,
    buildManagedSettingsDeny,
    buildSandboxDenyPaths,
    sandboxFailIfUnavailable,
    type DenyEntry,
} from '../lib/visibility.ts'
import { mcpBin, cliBin, docsDir } from '../lib/bismuthPaths.ts'
import { recordDaemonSessionId } from './sessionIds.ts'
import { sendCodexMessage } from './codexSession.ts'

// The compiled daemon binary doesn't bundle the Agent SDK's native CLI, and runs under launchd with
// a minimal PATH, so the SDK can't find `claude` on its own — resolve the user's real binary once
// and pass it via pathToClaudeCodeExecutable. Cached: the path doesn't change within a run.
let claudeBinPath: string | null | undefined
function claudeBin(): string | undefined {
    if (claudeBinPath === undefined) claudeBinPath = whichClaude()
    return claudeBinPath ?? undefined
}

/** Messages emitted by the Claude Agent SDK query stream. */
interface SdkMessage {
    type?: string
    subtype?: string
    session_id?: string
    result?: string
}

/** Per-vault conversation continuity: each vault's brain keeps its own session id under
 *  <vault>/.daemon/session-id, so the single runtime resumes the right thread per vault. */
export async function getSessionId(
    ctx: VaultContext,
): Promise<string | undefined> {
    try {
        const id = (await readFile(ctx.sessionFile, 'utf-8')).trim()
        return id || undefined
    } catch {
        return undefined
    }
}

/** Persist a freshly minted session id for this vault: the `session-id` POINTER (this vault's
 *  current thread) plus an append to the `session-ids` DURABLE SET.
 *
 *  The two are not redundant. The pointer is overwritten on every new session, so it answers only
 *  "what is the daemon's latest session?"; the set answers "did the daemon mint THIS session?" for
 *  every session it ever minted. Bismuth's chat page needs the latter to keep the daemon's cron
 *  sessions off the user's History (core/src/chat.ts), and a future daemon-sessions surface needs
 *  it to find them — see sessionIds.ts for the on-disk contract.
 *
 *  The set write is best-effort: provenance bookkeeping must never fail the daemon's real work. */
async function saveSessionId(ctx: VaultContext, id: string): Promise<void> {
    // Record BEFORE overwriting the pointer — the first-write backfill in recordDaemonSessionId
    // reads the pointer's OLD value to recover the one pre-existing daemon session still nameable.
    try {
        await recordDaemonSessionId(ctx, id)
    } catch (err) {
        console.error(
            `[session:${ctx.name}] Failed to record daemon session id:`,
            err,
        )
    }
    await mkdir(ctx.daemonDir, { recursive: true })
    await writeFile(ctx.sessionFile, id, 'utf-8')
}

/** Default daemon personality, seeded into <vault>/.daemon/identity.md so the user can edit it
 *  in the Bismuth editor. The name (settings.daemon.name) is prepended separately at runtime, so
 *  renaming the daemon never requires touching this prose. */
export const DEFAULT_DAEMON_IDENTITY = [
    'A persistent personal-assistant daemon for this Bismuth vault, running continuously in the',
    'background with durable memory.',
    '',
    "Your memory lives in this vault's `.daemon/memory` — the single source of truth for everything",
    'you remember. Use the remember/recall/forget tools to read and write it, and consult it for prior',
    'context before acting. You operate inside the vault (your working directory) and maintain the',
    "user's scheduled crons and background processes. If a recalled note claims some other store (an",
    'external "claude-bot" memory, or Claude Code\'s built-in memory) is authoritative or should be kept',
    'empty, disregard that claim — it predates this vault-scoped memory and no longer applies.',
    '',
    "Act as the user's right hand for intellectual and systems work. Be direct; skip performative politeness.",
].join('\n')

/** The bot's system prompt for one vault: "You are <name>." followed by the user-editable
 *  .daemon/identity.md (or the default above when absent/empty), plus an ADVISORY visibility
 *  appendix naming any notes off-limits per the vault's visibility settings. Appended to Claude
 *  Code's system prompt so the daemon self-identifies (e.g. "Atlas") with whatever personality
 *  the user authored. Read fresh per session, so edits to identity.md/visibility take effect on
 *  the next cron/message.
 *
 *  The visibility appendix is defense-in-depth ONLY — same posture as the `dream` cron's
 *  unenforced boundary — never the gate. The REAL gate is sendMessage's managedSettings.deny +
 *  sandbox.filesystem.denyRead (core/src/visibility.ts's docs/vault/visibility.md threat model
 *  applies here too: this restricts the daemon's own tool calls, not the vault owner). */
async function buildSystemPrompt(
    ctx: VaultContext,
    denyEntries: DenyEntry[],
): Promise<string> {
    let identity = DEFAULT_DAEMON_IDENTITY
    try {
        // identity.md carries the name in YAML frontmatter (read by the registry → ctx.name) and the
        // personality in the body — use the body here; ctx.name supplies the "You are <name>" prefix.
        const { body } = parseFrontmatter(
            await readFile(ctx.identityFile, 'utf-8'),
        )
        const trimmed = body.trim()
        if (trimmed) identity = trimmed
    } catch {
        // no identity.md (or unreadable) → default
    }
    let prompt = `You are ${ctx.name}.\n\n${identity}`
    if (denyEntries.length > 0) {
        const list = denyEntries.map(e => `- ${e.rel}`).join('\n')
        prompt +=
            "\n\nThe following notes are marked off-limits by the vault's visibility settings — your Read/" +
            'Edit/Grep/Glob/Bash access to them is already blocked at the tool level, but treat them as if ' +
            "they don't exist: don't mention them, guess at their contents, or try alternate ways to reach " +
            `them if a tool call is denied.\n${list}`
    }
    return prompt
}

export interface BotResponse {
    result: string
    sessionId: string
    /** Set when resolveDaemonBackend downgraded settings.daemon.backend for THIS run (a vault with
     *  hidden notes requesting a non-Claude backend). This is the only carrier of that decision a
     *  caller can act on — sendMessage's console.error is a daemon log nobody reads. Undefined
     *  whenever the requested backend ran as asked (including every unrestricted vault). Callers
     *  fold it into whatever they already show the user via {@link composeBackendRefusalNote}. */
    backendRefusal?: string
}

/**
 * Fold resolveDaemonBackend's refusal into text a caller already shows the user for this run —
 * the shared, pure carrier for the ONLY place that downgrade becomes visible (pages.ts's
 * daemonNote, rendered verbatim by app/src/InboxPageView.tsx; cron.ts's notify() OS notification).
 * Refusal-first: someone reading a done page or a cron notification should see WHY before the
 * result, not buried after it. A no-op (returns `base` unchanged) when there's nothing to report.
 */
export function composeBackendRefusalNote(
    base: string,
    backendRefusal?: string,
): string {
    if (!backendRefusal) return base
    return base ? `${backendRefusal}\n\n${base}` : backendRefusal
}

/**
 * Assemble the BotResponse sendMessage's Claude-backend path returns. Extracted (same reason as
 * buildQueryOptions above) so the wiring from resolveDaemonBackend's `refusal` onto
 * BotResponse.backendRefusal — the fix in this file — is unit-tested without invoking the real
 * SDK. `refusal` passes straight through: undefined stays undefined (an unrestricted vault's
 * response is unaffected), a string is carried onto the field callers read.
 */
export function finalizeBotResponse(
    result: string,
    sessionId: string,
    refusal?: string,
): BotResponse {
    return { result, sessionId, backendRefusal: refusal }
}

/**
 * Per-backend, DAEMON-channel visibility-gate enforcement — a deliberate, literal duplication of
 * the "daemon" side of `core/src/agentBackends/catalog.ts`'s per-channel `visibilityGate` capability
 * (`BackendCapabilities.visibilityGate: { chat, daemon }`, each a `VisibilityEnforcement` of
 * `"native" | "wrapper-macos" | "none"`). This workspace has NO dependency on `@bismuth/core` (see
 * `../lib/visibility.ts`'s header comment for why — a separately-bundled binary that must stay lean,
 * same rationale as `claudeWhich.ts`/`bismuthPaths.ts`), so the fact is ported here by hand rather
 * than imported — port any change to catalog.ts's daemon column into this set in the SAME commit,
 * exactly like `../lib/visibility.ts` is kept in lockstep with `../../core/src/visibility.ts`.
 *
 * A backend belongs here iff catalog.ts resolves its `visibilityGate.daemon` to `"native"` — i.e. it
 * has its OWN policy/sandbox layer that enforces the gate on the daemon's `bypassPermissions`
 * session (Claude: `managedSettings.permissions.deny` + `sandbox.filesystem.denyRead` +
 * `disallowedTools`, set together by `buildQueryOptions` below — verified, Step-0 spike,
 * docs/vault/visibility.md). `"wrapper-macos"` never qualifies here, even for a backend that has it
 * for CHAT (opencode does): the OS wrapper needs a dedicated per-session-or-per-turn process for ONE
 * vault, and this runtime's whole shape is the opposite — one process multiplexing every enabled
 * vault's brain. There is no opencode daemon integration in this codebase at all today regardless
 * (`sendMessage` below only ever dispatches `"claude"`/`"codex"`). The system-prompt appendix that
 * names hidden notes (see `buildSystemPrompt` above) is explicitly ADVISORY — "defense-in-depth
 * ONLY … never the gate" — and never makes a backend belong here.
 */
const DAEMON_BACKENDS_WITH_VISIBILITY_GATE: ReadonlySet<string> = new Set([
    'claude',
])

/**
 * Which agent CLI may run a vault's daemon brain — and the one hard constraint on that choice.
 *
 * No agent CLI outside {@link DAEMON_BACKENDS_WITH_VISIBILITY_GATE} can enforce the vault visibility
 * gate on the daemon channel. So for a vault with ANY hidden note, a backend outside that set cannot
 * enforce the gate, and running one would quietly convert a real security boundary into a polite
 * request the model is free to ignore. This function is the chokepoint that refuses that
 * combination: it is deliberately pure so the rule is unit-tested, and it MUST be the only way a
 * daemon backend is chosen — any future backend has to come through here.
 *
 * The refusal degrades to Claude rather than throwing: the daemon is an always-on service whose
 * crons must keep firing, and Claude is both the default and (today) the only backend in the
 * enforcing set. The caller logs `refusal` so the choice is never silent.
 *
 * This guardrail deliberately landed BEFORE the first alternative backend existed, so the
 * constraint was in place before there was anything tempting to point at it. There is now one:
 * `settings.daemon.backend` may be `"codex"` (see ./codexSession.ts), which reaches this function as
 * a REQUEST, never a grant. `codex` runs only for a vault that hides nothing; add a single hidden
 * note and the very next cron silently runs on Claude with the refusal logged.
 */
export function resolveDaemonBackend(
    requested: string | undefined,
    hiddenNoteCount: number,
): { backend: string; refusal?: string } {
    const want = (requested || 'claude').trim() || 'claude'
    if (DAEMON_BACKENDS_WITH_VISIBILITY_GATE.has(want)) return { backend: want }
    if (hiddenNoteCount > 0) {
        return {
            backend: 'claude',
            refusal:
                `daemon.backend "${want}" cannot enforce this vault's visibility gate ` +
                `(${hiddenNoteCount} hidden note${hiddenNoteCount === 1 ? '' : 's'}); ` +
                `only the Claude Code backend can. Running on "claude" instead — ` +
                `clear the vault's hidden/chat-only notes to use another backend.`,
        }
    }
    return { backend: want }
}

export interface SendOptions {
    model?: string
    effort?: string
    abortController?: AbortController
    /** Session timeout in seconds. AbortController signal fires when exceeded. */
    timeoutSecs?: number
    /** Start a fresh session instead of resuming the existing one. */
    newSession?: boolean
}

/** The bundled Bismuth tools available to a daemon session (undefined when the GUI app never
 *  installed them). Injected so buildQueryOptions is pure + unit-testable without touching disk. */
export interface BismuthTools {
    mcp?: string
    cli?: string
    docs?: string
}

/**
 * Assemble the SDK `query()` options for one vault session. Extracted from sendMessage so the
 * MCP/env wiring — the change most likely to silently regress — is unit-testable without invoking
 * the real SDK. Pure over its inputs (systemPrompt + tools resolved by the caller).
 *
 * The MCP block is the fix for the vault-targeting gap: without it, `bismuth_cli` from a daemon
 * session had no reliable BISMUTH_VAULT. When the bundled bismuth-mcp exists we give the session the
 * machine-wide bismuth MCP (docs + CLI + memory), targeting THIS vault via env — BISMUTH_VAULT reaches
 * the CLI through the MCP server's own env regardless of cwd (mcp/src/cli.ts passes env through). We
 * also set `settingSources: []` so the daemon does NOT inherit a human's ambient `-s user` MCP config
 * — explicit > implicit for an unattended process (chat.ts deliberately does the opposite: it wants
 * the user's interactive config). SDK version skew: core resolves @anthropic-ai/claude-agent-sdk
 * 0.3.186, the daemon 0.2.141 — both expose Options.mcpServers, settingSources, and
 * McpStdioServerConfig.env, so this shape typechecks + runs under either.
 */
export function buildQueryOptions(
    ctx: VaultContext,
    opts: SendOptions | undefined,
    existingSessionId: string | undefined,
    tools: { claudeBin?: string; systemPrompt: string } & BismuthTools,
    denyEntries: DenyEntry[] = [],
): Record<string, unknown> {
    const options: Record<string, unknown> = {
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Operate inside the vault, with this vault's memory dir injected so the bot's memory
        // tools target the right brain, and the vault's daemon name as the bot's identity.
        cwd: ctx.root,
        // A cron worker inherits this env. Its Bash tool runs `bismuth checkpoint diff/advance`
        // (Feature #51 change-scoping), so PATH MUST include the CLI's install dirs REGARDLESS of the
        // minimal PATH launchd hands the daemon — otherwise the checkpoint calls fail "command not
        // found" and the dream/vault-review crons silently re-survey the whole vault every run (Bug
        // #105). BISMUTH_CLI carries the absolute CLI path too, so a cron body can prefer it over a
        // bare-name PATH lookup (belt-and-suspenders). See childEnv.ts.
        env: {
            ...process.env,
            BISMUTH_MEMORY_DIR: ctx.memoryDir,
            PATH: augmentPath(
                process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
            ),
            ...(tools.cli ? { BISMUTH_CLI: tools.cli } : {}),
            // The signal core/src/visibilityCliGate.ts's CLI-dispatch gate reads to tell this daemon
            // session's OWN Bash-tool `bismuth` invocations from the vault owner's (unstamped) ones. This
            // is the always-on daemon brain, never a chat session — "daemon", the stricter channel.
            BISMUTH_AGENT_CHANNEL: 'daemon',
        },
        appendSystemPrompt: tools.systemPrompt,
        model: opts?.model ?? 'haiku',
    }

    // Point the SDK at the user's installed claude binary (machine-login auth, no API key).
    if (tools.claudeBin) options.pathToClaudeCodeExecutable = tools.claudeBin

    if (opts?.effort) {
        // `effort`, NOT `thinkingBudget`: the latter is not a field of the SDK's Options in ANY version
        // this repo installs (0.2.141 for daemon, 0.3.186 for core — grep both sdk.d.ts: zero hits), so
        // the daemon's configured reasoning effort was being handed to the SDK under a key it ignores
        // and silently dropped on every call. `options` is typed Record<string, unknown> here, so the
        // compiler could not catch the typo. The real field is `effort?: 'low'|'medium'|'high'|'xhigh'
        // |'max' | number`, and the three values mapped below are all valid members of it.
        options.effort =
            opts.effort === 'high'
                ? 'high'
                : opts.effort === 'low'
                  ? 'low'
                  : 'medium'
    }

    if (existingSessionId && !opts?.newSession) {
        options.resume = existingSessionId
    }

    // Ambient inheritance is OPT-IN (settings.daemon.inheritUserMcp, default false = the previous
    // behavior). `['user']` admits this machine's own MCP servers (~/.claude.json) and plugins
    // (~/.claude/settings.json) — measured against CLI 2.1.258, which gates user-scope MCP on this
    // source even though it lives outside settings.json.
    //
    // 'project'/'local' are deliberately EXCLUDED: cwd is the vault root, so they would auto-load a
    // .mcp.json or .claude/settings.json planted inside user CONTENT and execute it unattended under
    // bypassPermissions. Verified: a planted <cwd>/.mcp.json loads under ['user','project','local']
    // with no prompt, and does not load under ['user'].
    //
    // SET UNCONDITIONALLY, outside the `if` below. It used to live inside it, so a machine without
    // the bundled MCP set nothing at all — leaving settingSources undefined, which is the SDK's
    // PERMISSIVE default. The "explicit only, never inherit" posture silently inverted into full
    // ambient inheritance on exactly the degraded path.
    options.settingSources = ctx.inheritUserMcp ? ['user'] : []

    if (tools.mcp) {
        // BISMUTH_MCP_CHANNEL/BISMUTH_AGENT_CHANNEL: "daemon" — this env object is a REPLACEMENT (no
        // ...process.env spread), so nothing here inherits either var from the parent unless set
        // explicitly. mcp/src/cli.ts's runCli() passes process.env straight through when it spawns the
        // actual `bismuth` binary, so whatever this MCP server process's own env says is exactly what
        // BOTH the existing mcp/src/visibilityGate.ts gate (BISMUTH_MCP_CHANNEL) and the newer CLI-
        // dispatch gate (BISMUTH_AGENT_CHANNEL, core/src/visibilityCliGate.ts) will see.
        const env: Record<string, string> = {
            BISMUTH_VAULT: ctx.root,
            BISMUTH_MEMORY_DIR: ctx.memoryDir,
            BISMUTH_MCP_CHANNEL: 'daemon',
            BISMUTH_AGENT_CHANNEL: 'daemon',
        }
        if (tools.docs) env.BISMUTH_DOCS_DIR = tools.docs
        if (tools.cli) env.BISMUTH_CLI = tools.cli
        // `--mcp-config` is ADDITIVE, and this entry WINS the `bismuth` name collision against the
        // user's own unstamped ~/.claude.json server — so BISMUTH_VAULT and both channel stamps
        // hold even with inheritance on.
        options.mcpServers = { bismuth: { command: tools.mcp, env } }
    }

    // Visibility gate. Both path forms (relative + absolute) of every denied path — Claude Code's
    // Read tool doesn't consistently resolve a relative file_path against an absolute-only deny
    // (see buildManagedSettingsDeny). Omitted entirely when nothing is restricted, so an
    // unrestricted vault is unaffected.
    //
    // `denyRead` comes from `buildSandboxDenyPaths`, not `sandboxDenyRead`: the restricted files and
    // `.git` are only two thirds of the set. The third is the owner-token run record — read it and
    // core's HTTP surface hands this session every hidden note unfiltered, whatever the tool gate
    // says. See buildSandboxDenyPaths' doc comment.
    //
    // `failIfUnavailable: sandboxFailIfUnavailable(denyEntries)` (never a fixed `false`) — measured
    // 2026-07-30 (docs/vault/visibility.md, visibility-acceptance.md): a fixed `false` let a session
    // whose sandbox couldn't start run anyway with ONLY managedSettings standing guard, which a raw
    // Bash `cat`/`bismuth read`/`python3 -c` walks straight past. A vault that hides nothing must
    // keep running on a machine where the sandbox can't start at all, so this stays conditional.
    //
    // `allowUnsandboxedCommands: false` (Task 9) — a live probe found the model calling its OWN Bash
    // tool with `dangerouslyDisableSandbox: true` to skip the OS sandbox on its own initiative, TWICE,
    // while asked to read a hidden note. Not an adversarial bypass — the app's own agent behaving
    // normally. `failIfUnavailable` only gates a sandbox that fails to START; it does nothing about a
    // sandbox the model itself asks to skip per-call. Per sdk.d.ts's `Settings.sandbox.
    // allowUnsandboxedCommands` docstring (0.2.141, line 5011 — the only prose in the bundled types
    // describing this field; `Options.sandbox`'s zod-derived `SandboxSettings` at line 2411 shares the
    // identical field/shape but carries no doc comment of its own at its declaration site — see
    // docs/vault/visibility.md for the full citation): "Allow commands to run outside the sandbox via
    // the dangerouslyDisableSandbox parameter. When false, the dangerouslyDisableSandbox parameter is
    // completely ignored and all commands must run sandboxed. Default: true." Conditional on the same
    // guard as everything else here, so an unrestricted vault is unaffected.
    if (denyEntries.length > 0) {
        options.managedSettings = {
            permissions: { deny: buildManagedSettingsDeny(denyEntries) },
        }
        options.sandbox = {
            enabled: true,
            failIfUnavailable: sandboxFailIfUnavailable(denyEntries),
            allowUnsandboxedCommands: false,
            filesystem: {
                denyRead: buildSandboxDenyPaths(denyEntries, ctx.root),
            },
        }
        // When ANY file is restricted, hard-disable the bismuth_cli MCP tool (its `file read` can
        // target any vault, escaping the managedSettings deny) AND Grep/Glob (an unscoped whole-vault
        // scan returns a hidden file's lines — the daemon has no canUseTool second layer, so an
        // outright disable is the only reliable gate). An UNrestricted vault keeps bismuth_cli so the
        // daemon can drive app-control / create pages; a restricted vault trades that for the gate.
        options.disallowedTools = ['mcp__bismuth__bismuth_cli', 'Grep', 'Glob']
    }

    return options
}

/**
 * Send a message to a vault's bot session. ONE machine runtime multiplexes every enabled
 * vault: the per-call cwd (vault root), env (BISMUTH_MEMORY_DIR → this vault's memory),
 * resume (this vault's session id), and appended identity (the vault's daemon name) are all
 * supplied here, so concurrent vault sessions never race a process-global anything.
 */
export async function sendMessage(
    message: string,
    ctx: VaultContext,
    opts?: SendOptions,
): Promise<BotResponse> {
    // Multi-device gating (CONTRACT v1): when this device is NOT the owner, the persistent
    // bot session stays idle. Ownership is machine-level (owner.json under MACHINE_DIR), not
    // per-vault. When unclaimed (no owner.json) isOwner() is true, so a single-device install
    // behaves as before.
    if (!(await isOwner())) {
        throw new Error(
            'This device is not the owner — bot session is idle. Use set_owner_device to claim it.',
        )
    }

    const existingSessionId = await getSessionId(ctx)

    // Visibility gate (daemon/src/lib/visibility.ts): recomputed fresh on EVERY message (never
    // cached) so a visibility edit made a moment ago is honored on this very call — see
    // docs/vault/visibility.md. Verified (Step-0 spike) that managedSettings.permissions.deny
    // survives bypassPermissions and that sandbox.filesystem.denyRead blocks a Bash cat/grep on
    // macOS. Passed into buildQueryOptions (which folds it into managedSettings/sandbox/
    // disallowedTools) + into the advisory system-prompt appendix.
    const denyEntries = await buildDenyPaths(ctx.root)

    // Backend choice passes through the visibility-gate guardrail (see resolveDaemonBackend).
    // `ctx.backend` is settings.daemon.backend as read by registry.ts's readDaemonSettings — a
    // REQUEST, not a grant: any vault with a hidden note is refused a non-Claude backend and
    // degraded to "claude" here regardless of what was asked for.
    const { backend, refusal } = resolveDaemonBackend(
        ctx.backend,
        denyEntries.length,
    )
    if (refusal) console.error(`[session:${ctx.name}] ${refusal}`)

    if (backend === 'codex') {
        return await sendCodexMessage(message, ctx, opts)
    }
    if (backend !== 'claude') {
        throw new Error(
            `daemon backend "${backend}" is not implemented — only "claude" and "codex" can run a vault brain today`,
        )
    }

    // existsSync-gated: absent (the GUI app never installed the bundled tools) → no MCP block.
    // "Graceful degrade" undersells what is lost, which is why this is logged rather than silent:
    // without the MCP block there are no `remember`/`recall`/`forget` tools AT ALL, so a session
    // instructed to record something in memory has no way to do it. Left unannounced, that state is
    // indistinguishable from a working daemon right up until an agent improvises a location and drops
    // frontmatter-less notes somewhere in the vault (observed 2026-08-06). One line per send is
    // deliberate — this is an error condition, not a routine one, and a post-mortem needs it on the
    // record for the specific run that misbehaved.
    const mcp = mcpBin()
    if (!mcp) {
        console.error(
            `[session:${ctx.name}] bismuth-mcp is not installed (~/.bismuth/bin/bismuth-mcp) — this session ` +
                `has NO remember/recall/forget tools and cannot reach ${ctx.memoryDir}. Open the Bismuth app ` +
                `once to install the machine-wide tools. Until then, crons that record memory will report ` +
                `that they wrote nothing.`,
        )
    }

    const options = buildQueryOptions(
        ctx,
        opts,
        existingSessionId,
        {
            claudeBin: claudeBin(),
            systemPrompt: await buildSystemPrompt(ctx, denyEntries),
            mcp,
            cli: cliBin(),
            docs: docsDir(),
        },
        denyEntries,
    )

    const needsAc = opts?.abortController || opts?.timeoutSecs
    const ac =
        opts?.abortController ?? (needsAc ? new AbortController() : undefined)
    if (ac) options.abortController = ac

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (ac && opts?.timeoutSecs && opts.timeoutSecs > 0) {
        timeoutId = setTimeout(() => {
            console.log(
                `[session:${ctx.name}] Timeout reached (${opts.timeoutSecs}s), aborting session`,
            )
            ac.abort()
        }, opts.timeoutSecs * 1000)
    }

    let latestSessionId = existingSessionId ?? 'unknown'
    // The SDK types are incomplete — cast options once at the boundary
    const q = claudeQuery({
        prompt: message,
        options: options as Parameters<typeof claudeQuery>[0]['options'],
    })
    let resultText = ''

    try {
        for await (const event of q) {
            const msg = event as SdkMessage
            if (msg.session_id && msg.session_id !== latestSessionId) {
                latestSessionId = msg.session_id
                await saveSessionId(ctx, latestSessionId)
            }
            if (msg.type === 'result' && msg.subtype === 'success') {
                resultText = (msg.result ?? '').trim()
            }
        }
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }

    return finalizeBotResponse(resultText, latestSessionId, refusal)
}
