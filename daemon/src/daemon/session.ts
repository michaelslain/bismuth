import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk"
import { readFile, writeFile, mkdir } from "fs/promises"
import { parseFrontmatter } from "../lib/frontmatter.ts"
import type { VaultContext } from "../lib/config.ts"
import { isOwner } from "../lib/owner.ts"
import { whichClaude } from "../lib/claudeWhich.ts"
import { buildDenyPaths, buildManagedSettingsDeny, absDenyPaths, type DenyEntry } from "../lib/visibility.ts"

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
export async function getSessionId(ctx: VaultContext): Promise<string | undefined> {
  try {
    const id = (await readFile(ctx.sessionFile, "utf-8")).trim()
    return id || undefined
  } catch {
    return undefined
  }
}

async function saveSessionId(ctx: VaultContext, id: string): Promise<void> {
  await mkdir(ctx.daemonDir, { recursive: true })
  await writeFile(ctx.sessionFile, id, "utf-8")
}

/** Default daemon personality, seeded into <vault>/.daemon/identity.md so the user can edit it
 *  in the Bismuth editor. The name (settings.daemon.name) is prepended separately at runtime, so
 *  renaming the daemon never requires touching this prose. */
export const DEFAULT_DAEMON_IDENTITY = [
  "A persistent personal-assistant daemon for this Bismuth vault, running continuously in the",
  "background with durable memory.",
  "",
  "Your memory lives in this vault's `.daemon/memory` — use the remember/recall/forget tools to",
  "read and write it, and consult it for prior context before acting. You operate inside the vault",
  "(your working directory) and maintain the user's scheduled crons and background processes.",
  "",
  "Act as the user's right hand for intellectual and systems work. Be direct; skip performative politeness.",
].join("\n")

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
async function buildSystemPrompt(ctx: VaultContext, denyEntries: DenyEntry[]): Promise<string> {
  let identity = DEFAULT_DAEMON_IDENTITY
  try {
    // identity.md carries the name in YAML frontmatter (read by the registry → ctx.name) and the
    // personality in the body — use the body here; ctx.name supplies the "You are <name>" prefix.
    const { body } = parseFrontmatter(await readFile(ctx.identityFile, "utf-8"))
    const trimmed = body.trim()
    if (trimmed) identity = trimmed
  } catch {
    // no identity.md (or unreadable) → default
  }
  let prompt = `You are ${ctx.name}.\n\n${identity}`
  if (denyEntries.length > 0) {
    const list = denyEntries.map((e) => `- ${e.rel}`).join("\n")
    prompt +=
      "\n\nThe following notes are marked off-limits by the vault's visibility settings — your Read/" +
      "Edit/Grep/Glob/Bash access to them is already blocked at the tool level, but treat them as if " +
      "they don't exist: don't mention them, guess at their contents, or try alternate ways to reach " +
      `them if a tool call is denied.\n${list}`
  }
  return prompt
}

export interface BotResponse {
  result: string
  sessionId: string
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

/**
 * Send a message to a vault's bot session. ONE machine runtime multiplexes every enabled
 * vault: the per-call cwd (vault root), env (BISMUTH_MEMORY_DIR → this vault's memory),
 * resume (this vault's session id), and appended identity (the vault's daemon name) are all
 * supplied here, so concurrent vault sessions never race a process-global anything.
 */
export async function sendMessage(message: string, ctx: VaultContext, opts?: SendOptions): Promise<BotResponse> {
  // Multi-device gating (CONTRACT v1): when this device is NOT the owner, the persistent
  // bot session stays idle. Ownership is machine-level (owner.json under MACHINE_DIR), not
  // per-vault. When unclaimed (no owner.json) isOwner() is true, so a single-device install
  // behaves as before.
  if (!(await isOwner())) {
    throw new Error("This device is not the owner — bot session is idle. Use set_owner_device to claim it.")
  }

  const existingSessionId = await getSessionId(ctx)

  // Visibility gate (daemon/src/lib/visibility.ts, ported from core/src/visibility.ts):
  // recomputed fresh on EVERY message (never cached) so a visibility edit made a moment ago is
  // honored on this very call — see docs/vault/visibility.md. Verified (Step-0 spike) that
  // managedSettings.permissions.deny survives this session's exact permissionMode:
  // "bypassPermissions" + allowDangerouslySkipPermissions:true, and that sandbox.filesystem.
  // denyRead blocks a Bash `cat`/`grep` of the same paths at the OS level (macOS).
  const denyEntries = await buildDenyPaths(ctx.root)

  const options: Record<string, unknown> = {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Operate inside the vault, with this vault's memory dir injected so the bot's memory
    // tools target the right brain, and the vault's daemon name as the bot's identity.
    cwd: ctx.root,
    env: { ...process.env, BISMUTH_MEMORY_DIR: ctx.memoryDir },
    appendSystemPrompt: await buildSystemPrompt(ctx, denyEntries),
    model: opts?.model ?? "haiku",
    // Both forms (relative-to-cwd AND absolute) of every denied path — empirically, Claude
    // Code's Read tool does not consistently resolve a relative file_path against an
    // absolute-only deny pattern (see buildManagedSettingsDeny's doc comment). Omitted entirely
    // when there's nothing to restrict, so a vault with no visibility settings is unaffected.
    ...(denyEntries.length > 0
      ? {
          managedSettings: { permissions: { deny: buildManagedSettingsDeny(denyEntries) } },
          sandbox: { enabled: true, failIfUnavailable: false, filesystem: { denyRead: absDenyPaths(denyEntries) } },
        }
      : {}),
    // Blocks the CLI-bridge MCP tool's file-read escape hatch (bismuth_cli can target ANY vault
    // via its own --vault/--dir flags) — always. When ANY file is restricted, ALSO hard-disable
    // Grep and Glob: their per-file managedSettings deny only matches a call whose OWN `path`
    // argument is the denied file, but an UNSCOPED Grep(pattern, path: undefined) scans the whole
    // vault (including a hidden file) and returns its matching lines to the model — which, for the
    // daemon, IS the leak surface (it consolidates what it sees). The only reliable gate for a
    // broad scan is to forbid the tools outright. The daemon has no canUseTool second layer, so
    // this is load-bearing, not defense-in-depth.
    disallowedTools: denyEntries.length > 0
      ? ["mcp__bismuth__bismuth_cli", "Grep", "Glob"]
      : ["mcp__bismuth__bismuth_cli"],
  }

  // Point the SDK at the user's installed claude binary (machine-login auth, no API key).
  const bin = claudeBin()
  if (bin) options.pathToClaudeCodeExecutable = bin

  if (opts?.effort) {
    options.thinkingBudget = opts.effort === "high" ? "high" : opts.effort === "low" ? "low" : "medium"
  }

  const needsAc = opts?.abortController || opts?.timeoutSecs
  const ac = opts?.abortController ?? (needsAc ? new AbortController() : undefined)
  if (ac) options.abortController = ac

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (ac && opts?.timeoutSecs && opts.timeoutSecs > 0) {
    timeoutId = setTimeout(() => {
      console.log(`[session:${ctx.name}] Timeout reached (${opts.timeoutSecs}s), aborting session`)
      ac.abort()
    }, opts.timeoutSecs * 1000)
  }

  if (existingSessionId && !opts?.newSession) {
    options.resume = existingSessionId
  }

  let latestSessionId = existingSessionId ?? "unknown"
  // The SDK types are incomplete — cast options once at the boundary
  const q = claudeQuery({ prompt: message, options: options as Parameters<typeof claudeQuery>[0]["options"] })
  let resultText = ""

  try {
    for await (const event of q) {
      const msg = event as SdkMessage
      if (msg.session_id && msg.session_id !== latestSessionId) {
        latestSessionId = msg.session_id
        await saveSessionId(ctx, latestSessionId)
      }
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = (msg.result ?? "").trim()
      }
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  return { result: resultText, sessionId: latestSessionId }
}
