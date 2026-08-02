import { test, expect } from "bun:test"
import { buildQueryOptions, DEFAULT_DAEMON_IDENTITY, resolveDaemonBackend } from "../src/daemon/session.ts"
import type { VaultContext } from "../src/lib/config.ts"
import { ownerTokenDenyPath } from "../src/lib/bismuthPaths.ts"

const ctx = {
  root: "/vault",
  name: "Atlas",
  memoryDir: "/vault/.daemon/memory",
} as unknown as VaultContext

test("buildQueryOptions wires mcpServers.bismuth with vault-scoped env when the mcp binary exists", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, {
    claudeBin: "/usr/local/bin/claude",
    systemPrompt: "You are Atlas.",
    mcp: "/home/me/.bismuth/bin/bismuth-mcp",
    cli: "/home/me/.bismuth/bin/bismuth",
    docs: "/home/me/.bismuth/docs",
  })
  expect(o.cwd).toBe("/vault")
  expect(o.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude")
  expect(o.mcpServers).toEqual({
    bismuth: {
      command: "/home/me/.bismuth/bin/bismuth-mcp",
      env: {
        BISMUTH_VAULT: "/vault",
        BISMUTH_MEMORY_DIR: "/vault/.daemon/memory",
        BISMUTH_DOCS_DIR: "/home/me/.bismuth/docs",
        BISMUTH_CLI: "/home/me/.bismuth/bin/bismuth",
        BISMUTH_MCP_CHANNEL: "daemon",
        BISMUTH_AGENT_CHANNEL: "daemon",
      },
    },
  })
  // Explicit-only: the daemon must not inherit a human's ambient `-s user` MCP servers.
  expect(o.settingSources).toEqual([])
})

// The CLI-dispatch visibility gate (core/src/visibilityCliGate.ts) reads BISMUTH_AGENT_CHANNEL to
// tell the daemon's own `bismuth` invocations (this session's Bash tool) from the vault owner's
// (unstamped) ones. Stamped on BOTH the base session env and the MCP server's own env — see the
// comments in session.ts for why the MCP block needs it set explicitly (it's a replacement object,
// not a spread of process.env).
test("buildQueryOptions stamps BISMUTH_AGENT_CHANNEL=daemon on the base session env", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" })
  expect((o.env as Record<string, string>).BISMUTH_AGENT_CHANNEL).toBe("daemon")
})

test("buildQueryOptions omits the MCP block entirely when the mcp binary is absent (graceful degrade)", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "You are Atlas." })
  expect(o.mcpServers).toBeUndefined()
  expect(o.settingSources).toBeUndefined()
  // The base options still hold (memory dir injected via env).
  expect((o.env as Record<string, string>).BISMUTH_MEMORY_DIR).toBe("/vault/.daemon/memory")
})

// Bug #105: a cron worker inherits this env; its Bash `bismuth checkpoint …` must resolve
// regardless of the minimal PATH launchd hands the daemon, so PATH is augmented with the CLI's
// install dirs no matter the ambient PATH.
test("buildQueryOptions augments the child env PATH with the CLI install dirs", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" })
  const path = (o.env as Record<string, string>).PATH
  expect(path).toContain("/usr/local/bin")
  expect(path).toContain("/opt/homebrew/bin")
  expect(path).toContain(".bismuth/bin")
})

// Belt-and-suspenders: when the CLI is installed, its absolute path is exported so a cron body can
// prefer "$BISMUTH_CLI" over a bare-name PATH lookup. Absent → not set (graceful degrade).
test("buildQueryOptions exports BISMUTH_CLI only when the CLI binary is present", () => {
  const withCli = buildQueryOptions(ctx, undefined, undefined, {
    systemPrompt: "x",
    cli: "/home/me/.bismuth/bin/bismuth",
  })
  expect((withCli.env as Record<string, string>).BISMUTH_CLI).toBe("/home/me/.bismuth/bin/bismuth")
  const withoutCli = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" })
  expect((withoutCli.env as Record<string, string>).BISMUTH_CLI).toBeUndefined()
})

// 2026-07-30 measurement (docs/vault/visibility.md, visibility-acceptance.md): buildQueryOptions
// used to hardcode `sandbox.failIfUnavailable: false`, so a session whose OS sandbox couldn't
// start ran anyway with only managedSettings standing guard — which restricts the Read/Edit/Grep/
// Glob tool CALLING CONVENTION and does nothing to a raw Bash `cat`/`bismuth read`/`python3 -c`.
// It's now derived from the deny list: a restricted vault fails closed, an unrestricted one is
// unaffected (the whole sandbox block stays omitted, same as before this fix).
test("buildQueryOptions: sandbox.failIfUnavailable is true when the vault restricts notes", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" }, [
    { rel: "secret.md", abs: "/vault/secret.md" },
  ])
  expect((o.sandbox as { failIfUnavailable?: boolean } | undefined)?.failIfUnavailable).toBe(true)
})

test("buildQueryOptions: sandbox is omitted entirely (not merely failIfUnavailable:false) when nothing is restricted — an unrestricted vault must not risk failing on a machine with no sandbox support", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" }, [])
  expect(o.sandbox).toBeUndefined()
  expect(o.managedSettings).toBeUndefined()
})

// Task 9: a live probe of the previous task found the model calling its OWN Bash tool with
// `dangerouslyDisableSandbox: true` to skip the OS sandbox on its own initiative, TWICE, while
// being asked to read a hidden note — not an adversarial bypass, just the app's own agent behaving
// normally. `failIfUnavailable` alone only gates a sandbox that fails to START; it does nothing
// about a sandbox the model itself asks to skip per-call. `allowUnsandboxedCommands: false` is what
// makes the SDK ignore that parameter outright (sdk.d.ts's `Settings.sandbox.allowUnsandboxedCommands`
// docstring — the only prose in the bundled types describing this field; see docs/vault/visibility.md
// for the full citation). Conditional on the same `denyEntries.length > 0` guard as every other gate
// here — the negative case (unrestricted vault → sandbox omitted entirely) is already covered by the
// test directly above.
test("buildQueryOptions: sandbox.allowUnsandboxedCommands is false when the vault restricts notes", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" }, [
    { rel: "secret.md", abs: "/vault/secret.md" },
  ])
  expect((o.sandbox as { allowUnsandboxedCommands?: boolean } | undefined)?.allowUnsandboxedCommands).toBe(false)
})

// The owner token (core/src/ownerToken.ts) makes an HTTP request the OWNER — unfiltered. It lives
// in the run record OUTSIDE the vault, so no vault-derived deny reaches it, and its 0600 mode stops
// another user rather than this session, which runs as the uid that wrote it. A daemon session that
// can read that file can present X-Bismuth-Token to GET /file and read back every note this sandbox
// exists to hide, which makes a deny list that omits it self-defeating.
test("buildQueryOptions: sandbox.filesystem.denyRead covers the owner-token run record", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "x" }, [
    { rel: "secret.md", abs: "/vault/secret.md" },
  ])
  const denyRead = (o.sandbox as { filesystem?: { denyRead?: string[] } } | undefined)?.filesystem?.denyRead ?? []
  expect(denyRead).toContain(ownerTokenDenyPath("/vault"))
  // and it still covers what it always covered
  expect(denyRead).toContain("/vault/secret.md")
  expect(denyRead).toContain("/vault/.git")
})

test("buildQueryOptions resumes an existing session unless newSession is set", () => {
  expect(buildQueryOptions(ctx, undefined, "sess-1", { systemPrompt: "x" }).resume).toBe("sess-1")
  expect(buildQueryOptions(ctx, { newSession: true }, "sess-1", { systemPrompt: "x" }).resume).toBeUndefined()
})

// The auto-injected daemon guidance must name the CURRENT source of truth (this vault's
// .daemon/memory) and must NOT carry the stale post-absorption framing that a standalone
// "claude-bot" store is authoritative or that Claude Code's built-in memory is deprecated /
// should stay empty. Regression guard for the injected system-prompt path.
test("DEFAULT_DAEMON_IDENTITY names .daemon/memory as the single source of truth", () => {
  expect(DEFAULT_DAEMON_IDENTITY).toContain(".daemon/memory")
  expect(DEFAULT_DAEMON_IDENTITY.toLowerCase()).toContain("single source of truth")
})

test("DEFAULT_DAEMON_IDENTITY does not present claude-bot / a built-in store as authoritative", () => {
  const lower = DEFAULT_DAEMON_IDENTITY.toLowerCase()
  // It's fine (and intended) to NEUTRALIZE the stale framing, but never to assert it: the
  // identity must not tell the daemon that claude-bot is the source of truth or that the
  // built-in dir is deprecated / must be kept empty as standing guidance.
  expect(lower).not.toContain("claude-bot memory is the source of truth")
  expect(lower).not.toContain("deprecated")
  // The only mention of claude-bot / built-in memory is inside the disregard clause.
  const disregardClause = /disregard[\s\S]*claude code's built-in memory|claude code's built-in memory[\s\S]*disregard/i
  if (lower.includes("claude-bot") || lower.includes("built-in memory")) {
    expect(disregardClause.test(DEFAULT_DAEMON_IDENTITY)).toBe(true)
  }
})

// --- the visibility-gate guardrail on backend choice ---------------------------------------------
// The gate is enforced by three Claude-Code-specific mechanisms together (managedSettings deny,
// sandbox denyRead, disallowedTools). No other CLI has them, so a vault with hidden notes may not
// run its brain on another backend — the advisory system-prompt appendix is NOT the gate.

test("claude is always allowed, hidden notes or not", () => {
  expect(resolveDaemonBackend("claude", 0)).toEqual({ backend: "claude" })
  expect(resolveDaemonBackend("claude", 7)).toEqual({ backend: "claude" })
})

test("an unset backend defaults to claude", () => {
  expect(resolveDaemonBackend(undefined, 0)).toEqual({ backend: "claude" })
  expect(resolveDaemonBackend("", 3)).toEqual({ backend: "claude" })
  expect(resolveDaemonBackend("   ", 3)).toEqual({ backend: "claude" })
})

test("a non-claude backend is allowed only when the vault hides nothing", () => {
  expect(resolveDaemonBackend("codex", 0)).toEqual({ backend: "codex" })
})

test("a non-claude backend is REFUSED when any note is hidden, degrading to claude with a reason", () => {
  const r = resolveDaemonBackend("codex", 1)
  expect(r.backend).toBe("claude")
  expect(r.refusal).toContain("codex")
  expect(r.refusal).toContain("visibility gate")
  // Degrades rather than throwing: the daemon is always-on and its crons must keep firing.
  expect(r.refusal).toContain("1 hidden note")
})

test("the refusal pluralises the hidden-note count", () => {
  expect(resolveDaemonBackend("codex", 4).refusal).toContain("4 hidden notes")
})

test("codex is refused for a vault with hidden notes — the ONE path that must never regress", () => {
  // The security property, asserted end-to-end at the chokepoint sendMessage actually calls: with a
  // hidden note present, no request for codex can produce a codex run. sendMessage dispatches on
  // THIS return value (`if (backend === "codex")`), so a "claude" result here is what makes the
  // codex branch unreachable for a restricted vault.
  for (const hidden of [1, 2, 50]) {
    const r = resolveDaemonBackend("codex", hidden)
    expect(r.backend).toBe("claude")
    expect(r.refusal).toBeDefined()
  }
  // And it IS allowed once nothing is hidden — otherwise the setting would be dead weight.
  expect(resolveDaemonBackend("codex", 0)).toEqual({ backend: "codex" })
})
