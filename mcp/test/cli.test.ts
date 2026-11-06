import { test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { runCli, formatCliResult, cliToolResult } from '../src/cli'

// repoRoot resolves to the workspace root (mcp/test → ../..), the CLI's dev fallback.
const repoRoot = resolve(import.meta.dir, '..', '..')

test('bismuth_cli --help surfaces the app + page groups (app control rides the CLI)', async () => {
    const r = await runCli(repoRoot, ['--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('app open')
    expect(r.stdout).toContain('page create')
}, 30_000)

test('bismuth_cli [group, --help] scopes the listing to that group', async () => {
    const r = await runCli(repoRoot, ['task', '--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('task list')
    expect(r.stdout).not.toContain('app open')
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
