import { test, expect } from "bun:test"
import { buildQueryOptions, DEFAULT_DAEMON_IDENTITY } from "../src/daemon/session.ts"
import type { VaultContext } from "../src/lib/config.ts"

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
      },
    },
  })
  // Explicit-only: the daemon must not inherit a human's ambient `-s user` MCP servers.
  expect(o.settingSources).toEqual([])
})

test("buildQueryOptions omits the MCP block entirely when the mcp binary is absent (graceful degrade)", () => {
  const o = buildQueryOptions(ctx, undefined, undefined, { systemPrompt: "You are Atlas." })
  expect(o.mcpServers).toBeUndefined()
  expect(o.settingSources).toBeUndefined()
  // The base options still hold (memory dir injected via env).
  expect((o.env as Record<string, string>).BISMUTH_MEMORY_DIR).toBe("/vault/.daemon/memory")
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
