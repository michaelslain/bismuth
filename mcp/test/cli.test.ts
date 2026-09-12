import { test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { cliHelp, runCli, formatCliResult, cliToolResult } from '../src/cli'

// The MCP's bismuth_cli_help tool bridges to the CLI's own --help. This verifies the bridge works
// AND that the new app-control surface (the `app` + `page` groups) is discoverable through it — the
// whole point of routing app control through the existing bismuth_cli tool instead of adding new MCP
// tool schemas. repoRoot resolves to the workspace root (mcp/test → ../..), the CLI's dev fallback.
const repoRoot = resolve(import.meta.dir, '..', '..')

test('bismuth_cli_help surfaces the app + page groups (zero new MCP tools; app control rides the CLI)', async () => {
    const help = await cliHelp(repoRoot)
    expect(help.ok).toBe(true)
    expect(help.text).toContain('app windows')
    expect(help.text).toContain('app open')
    expect(help.text).toContain('app run')
    expect(help.text).toContain('page create')
}, 30_000)

// Regression for the scoped-help fallback that never fired: cli/src/index.ts used to dispatch
// ONLY on exact registered keys (`task list`, never a bare `task`), so `bismuth task --help`
// printed "unknown command" plus the ENTIRE global listing and exited 1 — cliHelp's `scoped.code
// === 0` check then always failed and it silently fell back to the full listing every time,
// defeating the tool's whole token-frugal point. Now the CLI itself recognizes an unmatched first
// word that prefixes registered commands (`task` prefixes `task list`/`task toggle`/…) followed
// by `--help` and prints just that group. Pin the fix at the level the MCP tool actually calls
// through (cliHelp), by proving the scoped listing is a genuine, strict subset of the global one —
// not merely non-empty, which the pre-fix full-listing fallback would also have satisfied.
test('cliHelp(repoRoot, "task") returns a strict subset of the global help, scoped to the task group', async () => {
    const scoped = await cliHelp(repoRoot, 'task')
    const global = await cliHelp(repoRoot)
    expect(scoped.ok).toBe(true)
    expect(global.ok).toBe(true)

    // Strictly smaller — the whole point of scoping.
    expect(scoped.text.length).toBeLessThan(global.text.length)

    // Every command-entry line the scoped listing prints is a line that also appears, verbatim,
    // in the global listing (same padding width — see cli/src/index.ts's shared KEY_WIDTH) — so
    // this isn't just "some text", it's the real registry entries.
    const scopedEntryLines = scoped.text
        .split('\n')
        .filter(line => line.startsWith('  task '))
    expect(scopedEntryLines.length).toBeGreaterThan(0)
    const globalLines = new Set(global.text.split('\n'))
    for (const line of scopedEntryLines) expect(globalLines.has(line)).toBe(true)

    // Scoped to `task` only — none of another group's entries leaked in.
    expect(scoped.text).not.toContain('app windows')
    expect(scoped.text).not.toContain('graph')
})

// Regression for the inert isError check the reviewer caught: cliHelp used to return a bare
// string, and server.ts inferred failure from `text.trim().length === 0` — a check that can
// never be true, since the total-failure path itself returns a non-empty message. This asserts
// on the discriminated `ok` field, not on the message text, so it can't pass by accident.
test('cliHelp reports ok:false when the CLI cannot be run at all (repoRoot points nowhere real)', async () => {
    const result = await cliHelp('/definitely/not/a/real/bismuth-repo-root-xyz')
    expect(result.ok).toBe(false)
}, 30_000)

test('runCli/formatCliResult surface a non-zero exit code with an [exit N] marker (unchanged by this fix; cliToolResult below is what actually maps it to isError)', async () => {
    const r = await runCli(repoRoot, ['definitely-not-a-command'])
    expect(r.code).not.toBe(0)
    expect(formatCliResult(r)).toContain('[exit')
}, 30_000)

test('cliToolResult marks a non-zero exit as isError', () => {
    expect(cliToolResult({ code: 1, stdout: '', stderr: 'boom' }).isError).toBe(
        true,
    )
})

test('cliToolResult leaves a clean exit unflagged', () => {
    expect(cliToolResult({ code: 0, stdout: 'ok', stderr: '' }).isError).toBe(
        false,
    )
})
