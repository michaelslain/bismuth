import { test, expect } from "bun:test"
import { buildQueryOptions } from "../src/daemon/session.ts"
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
