import { test, expect } from 'bun:test'
import { SERVER_INSTRUCTIONS } from './instructions'
import { server } from './server'

// This MCP is machine-wide (mcp/server.ts loads into every session on the machine, per
// docs/mcp/overview.md), so `instructions` — read by the client BEFORE any tool call — has to
// stay cheap. Pinning a ceiling here means a future edit that grows it has to consciously raise
// the number rather than drifting past "terse" one clause at a time.
test('SERVER_INSTRUCTIONS stays terse', () => {
    const words = SERVER_INSTRUCTIONS.trim().split(/\s+/).length
    expect(words).toBeLessThan(120)
})

test('SERVER_INSTRUCTIONS points an agent at the companion note instead of a new .md that embeds the file', () => {
    expect(SERVER_INSTRUCTIONS).toContain('companion')
    expect(SERVER_INSTRUCTIONS).toMatch(/<file>\.<ext>\.md/)
    expect(SERVER_INSTRUCTIONS).toContain('paper.pdf.md')
    expect(SERVER_INSTRUCTIONS).toMatch(/bismuth prop set/)
    expect(SERVER_INSTRUCTIONS.toUpperCase()).toContain('NEVER')
    expect(SERVER_INSTRUCTIONS).toContain('![[paper.pdf]]')
})

test('SERVER_INSTRUCTIONS names the ink sidecar and points at the frontmatter doc for more', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/<file>\.<ext>\.draw/)
    expect(SERVER_INSTRUCTIONS).toContain('bismuth_docs_read')
    expect(SERVER_INSTRUCTIONS).toContain('vault/frontmatter.md')
})

// Proves the constant is actually wired into the running server, not just sitting in its own
// module unused — the SDK's `Server` stores it on a plain (TS-`private`, not JS `#private`)
// `_instructions` field, set verbatim from the `instructions` option passed at construction.
test('the running server actually advertises SERVER_INSTRUCTIONS, not just a constant nobody wired up', () => {
    const instructions = (server as unknown as { _instructions?: string })
        ._instructions
    expect(instructions).toBe(SERVER_INSTRUCTIONS)
})
