import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Codex, type ModelReasoningEffort, type ThreadEvent } from "@openai/codex-sdk"
import type { VaultContext } from "../lib/config.ts"
import { whichBinary } from "../lib/claudeWhich.ts"
import { augmentPath } from "../lib/childEnv.ts"
import { writeAgentsMdBlock } from "../lib/agentsMd.ts"
import { parseFrontmatter } from "../lib/frontmatter.ts"
import type { BotResponse, SendOptions } from "./session.ts"

/**
 * The Codex daemon backend: runs a vault's brain on OpenAI's Codex CLI via the official
 * `@openai/codex-sdk` instead of the Claude Agent SDK. Selected ONLY through
 * session.ts's resolveDaemonBackend, which refuses this backend outright for any vault with a
 * hidden note — see that function's docs for why (Codex has no equivalent of Claude's
 * managedSettings/sandbox/disallowedTools visibility-gate triple). This module never has to
 * re-check that itself; it trusts the caller already did.
 *
 * Architecture mirrors session.ts's Claude path as closely as the two SDKs allow:
 *  - Per-vault conversation continuity: a durable thread id under
 *    <vault>/.daemon/codex-session-id (a SEPARATE file from Claude's session-id, so switching
 *    settings.daemon.backend back and forth never corrupts either backend's own continuity).
 *  - Per-call cwd: ThreadOptions.workingDirectory = ctx.root.
 *  - Per-call env: CODEX_HOME scoped to <vault>/.daemon/codex, so this vault's Codex session state
 *    (auth cache aside — Codex's login is machine-wide either way) never collides with another
 *    enabled vault's, or with the operator's own personal `~/.codex`. NOTE: pointing CODEX_HOME at
 *    a per-vault directory is NOT documented by OpenAI for multi-tenant use — it is an inference
 *    from CODEX_HOME's documented purpose (config/session root) confirmed only by reading the
 *    shipped SDK's own env-handling code, not by a live smoke test (no `codex` binary is installed
 *    in this sandbox). Verify this actually isolates auth/session state per vault before relying on
 *    it in production — see this task's final report.
 *  - Persona/system-prompt equivalent: Codex's SDK exposes NO systemPrompt-shaped field on
 *    ThreadOptions (confirmed absent from the shipped .d.ts) — AGENTS.md is its designed channel
 *    instead (see docs/chat/backends.md's Surface 6). writeIdentityAgentsMd below refreshes a
 *    managed block in the vault's AGENTS.md with the SAME identity.md-derived text
 *    buildSystemPrompt would have appended for Claude, gated on settings.codex.writeAgentsMd
 *    (VaultContext.codexWriteAgentsMd) — off means the Codex brain runs with NO persona/memory
 *    context at all, which is an honest degrade, not a silent one (logged once per send).
 *  - Headless: approvalPolicy "never" + sandboxMode "workspace-write" — `codex exec` (what the SDK
 *    always drives) has no TTY to prompt on regardless, but this is explicit for determinism,
 *    matching the chat driver's identical posture.
 */

const DEFAULT_DAEMON_IDENTITY_FALLBACK =
  "A persistent personal-assistant daemon for this Bismuth vault, running continuously in the background."

function codexThreadIdFile(ctx: VaultContext): string {
  return join(ctx.daemonDir, "codex-session-id")
}

function codexHomeDir(ctx: VaultContext): string {
  return join(ctx.daemonDir, "codex")
}

async function getCodexThreadId(ctx: VaultContext): Promise<string | undefined> {
  try {
    const id = (await readFile(codexThreadIdFile(ctx), "utf-8")).trim()
    return id || undefined
  } catch {
    return undefined
  }
}

async function saveCodexThreadId(ctx: VaultContext, id: string): Promise<void> {
  try {
    await mkdir(ctx.daemonDir, { recursive: true })
    await writeFile(codexThreadIdFile(ctx), id, "utf-8")
  } catch (err) {
    console.error(`[codexSession:${ctx.name}] Failed to persist Codex thread id:`, err)
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
    const { body } = parseFrontmatter(await readFile(ctx.identityFile, "utf-8"))
    const trimmed = body.trim()
    if (trimmed) identity = trimmed
  } catch {
    // no identity.md (or unreadable) → fallback
  }
  const content = [
    `You are ${ctx.name}, a Bismuth daemon brain running on OpenAI Codex.`,
    "",
    identity,
    "",
    "Your memory lives in this vault's `.daemon/memory` — consult it (via the bismuth MCP tools, if",
    "configured) before acting, and prefer linking to existing vault notes over duplicating them.",
  ].join("\n")
  writeAgentsMdBlock(ctx.root, content)
}

let codexBinPath: string | null | undefined
function codexBin(): string | null {
  if (codexBinPath === undefined) codexBinPath = whichBinary("codex")
  return codexBinPath
}

const EFFORT_VALUES: readonly ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"]
function asEffort(v: string | undefined): ModelReasoningEffort | undefined {
  return v && (EFFORT_VALUES as readonly string[]).includes(v) ? (v as ModelReasoningEffort) : undefined
}

/** Send a message to a vault's Codex-backed brain. Mirrors session.ts's sendMessage signature/
 *  return shape exactly, so daemon/src/daemon/session.ts's dispatch can treat both backends
 *  uniformly. Assumes the caller (session.ts) has ALREADY passed this vault through
 *  resolveDaemonBackend — this function does not re-check the visibility gate itself. */
export async function sendCodexMessage(message: string, ctx: VaultContext, opts?: SendOptions): Promise<BotResponse> {
  const bin = codexBin()
  if (!bin) {
    throw new Error(
      "daemon backend \"codex\" is selected but the `codex` CLI was not found on PATH — install it " +
        "(`npm i -g @openai/codex`) and run `codex` once to log in.",
    )
  }

  await refreshIdentityAgentsMd(ctx)

  const existingThreadId = opts?.newSession ? undefined : await getCodexThreadId(ctx)

  const codexHome = codexHomeDir(ctx)
  await mkdir(codexHome, { recursive: true }).catch(() => {})
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: augmentPath(process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"),
    CODEX_HOME: codexHome,
  }

  const codex = new Codex({ codexPathOverride: bin, env })
  const threadOptions = {
    workingDirectory: ctx.root,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "never" as const,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(asEffort(opts?.effort) ? { modelReasoningEffort: asEffort(opts?.effort) } : {}),
  }
  const thread = existingThreadId ? codex.resumeThread(existingThreadId, threadOptions) : codex.startThread(threadOptions)

  const signal = opts?.abortController?.signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const ac = opts?.abortController
  if (ac && opts?.timeoutSecs && opts.timeoutSecs > 0) {
    timeoutId = setTimeout(() => {
      console.log(`[codexSession:${ctx.name}] Timeout reached (${opts.timeoutSecs}s), aborting session`)
      ac.abort()
    }, opts.timeoutSecs * 1000)
  }

  let resultText = ""
  let threadId = existingThreadId ?? "unknown"
  try {
    const { events } = await thread.runStreamed(message, { signal })
    for await (const event of events as AsyncGenerator<ThreadEvent>) {
      if (event.type === "thread.started" && event.thread_id && event.thread_id !== threadId) {
        threadId = event.thread_id
        await saveCodexThreadId(ctx, threadId)
      } else if (event.type === "item.completed" && event.item.type === "agent_message") {
        resultText = event.item.text
      }
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  return { result: resultText, sessionId: threadId }
}
