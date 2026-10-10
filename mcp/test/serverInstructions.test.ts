import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER_INSTRUCTIONS } from '../src/instructions'
import { server } from '../src/server'

// This MCP is machine-wide (mcp/server.ts loads into every session on the machine, per
// docs/mcp/overview.md), so `instructions` — read by the client BEFORE any tool call — has to
// stay cheap. Pinning a ceiling here means a future edit that grows it has to consciously raise
// the number rather than drifting past "terse" one clause at a time. Raised 120 → 150 when the
// guide triggers moved here from the retired Claude Code skills (whose three descriptions cost
// every session about as much). Raised 150 → 160 for the one-sentence bismuth_doctor pointer.
// Raised 160 → 200 for the visibility pointer: without it an agent asked "which notes are off
// limits to ai" grepped invented frontmatter keys and never found the one command that answers.
// Raised 200 → 240 for the task pointer: asked "when is my essay draft due", a chat grepped the
// vault for "essay", a word no task used, before reading a task file by hand.
// Raised 240 → 280 for the brain / vault_map pointer: a session with no vault map in context has to
// know to ask for one.
test('SERVER_INSTRUCTIONS stays terse', () => {
    const words = SERVER_INSTRUCTIONS.trim().split(/\s+/).length
    expect(words).toBeLessThan(280)
})

test('SERVER_INSTRUCTIONS sends task and deadline questions to bismuth task list', () => {
    expect(SERVER_INSTRUCTIONS).toContain('bismuth task list --query')
})

test('SERVER_INSTRUCTIONS answers "what is hidden from AI" with the deny-list command', () => {
    expect(SERVER_INSTRUCTIONS).toContain('bismuth settings deny-list')
    expect(SERVER_INSTRUCTIONS).toContain('vault/visibility.md')
})

test('SERVER_INSTRUCTIONS sends a misbehaving install to bismuth_doctor first', () => {
    expect(SERVER_INSTRUCTIONS).toContain('run bismuth_doctor first')
})

test('SERVER_INSTRUCTIONS tells an agent to read the bases guide every time it touches a base', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/EVERY time/)
    expect(SERVER_INSTRUCTIONS).toContain('type: base')
    expect(SERVER_INSTRUCTIONS).toContain('bases/authoring.md')
    expect(SERVER_INSTRUCTIONS).toContain('bases/authoring/<view kind>.md')
})

test('SERVER_INSTRUCTIONS points vault conversions at both guides', () => {
    expect(SERVER_INSTRUCTIONS).toContain('guides/converting-obsidian-to-bismuth.md')
    expect(SERVER_INSTRUCTIONS).toContain('guides/converting-bismuth-to-obsidian.md')
})

// Every docs path the instructions name must exist, or the trigger sends agents to a 404.
test('every docs page SERVER_INSTRUCTIONS names exists', () => {
    const docs = join(import.meta.dir, '..', '..', 'docs')
    const named = [...SERVER_INSTRUCTIONS.matchAll(/\b([a-z]+(?:\/[a-z-]+)+\.md)\b/g)].map(m => m[1])
    expect(named.length).toBeGreaterThan(3)
    for (const p of named) expect(existsSync(join(docs, p)), p).toBe(true)
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

test('SERVER_INSTRUCTIONS sends theme work to the custom themes guide', () => {
    expect(SERVER_INSTRUCTIONS).toContain('guides/custom-themes.md')
})
