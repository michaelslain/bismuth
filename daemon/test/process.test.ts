// enableProcess/disableProcess's "is it already in the target state?" checks must agree with
// parseProcessFrontmatter's own default, which treats a definition with NO `enabled:` key as
// ENABLED (`frontmatter.enabled !== "false"`). enableProcess used to ask `=== "true"`, so a file
// that omitted the key looked disabled to it and a no-op enable rewrote the file on disk —
// contradicting the function's documented "Idempotent: succeeds even if already enabled".
// These tests pin the agreement, in both directions, by asserting on the file's mtime+bytes.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    readFileSync,
    statSync,
    mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    enableProcess,
    disableProcess,
    startProcesses,
    listProcesses,
    stopProcessesForVault,
} from '../src/daemon/process.ts'
import { parseFrontmatter } from '../src/lib/frontmatter.ts'
import type { VaultContext } from '../src/lib/config.ts'

let processesDir: string
let ctx: VaultContext

beforeEach(() => {
    processesDir = mkdtempSync(join(tmpdir(), 'bismuth-process-fixture-'))
    ctx = { processesDir, root: processesDir } as unknown as VaultContext
})

afterEach(() => {
    rmSync(processesDir, { recursive: true, force: true })
})

function procFile(name: string, fm: string, body = 'a process'): string {
    const p = join(processesDir, `${name}.md`)
    writeFileSync(p, `---\n${fm}\n---\n\n${body}\n`)
    return p
}

test('enabling a process whose file OMITS `enabled:` does not rewrite the file (it is already enabled)', async () => {
    // No `enabled:` key at all — parseProcessFrontmatter reads this as enabled:true.
    const p = procFile('implicit', 'command: sleep')
    const before = readFileSync(p, 'utf-8')

    const res = await enableProcess('implicit', ctx)
    expect(res.ok).toBe(true)

    // The file is untouched — byte-for-byte. Before the fix this gained an `enabled: "true"` line.
    expect(readFileSync(p, 'utf-8')).toBe(before)
    expect(before).not.toContain('enabled')
})

test('enabling a process that is explicitly disabled DOES flip it on disk', async () => {
    const p = procFile('off', 'command: sleep\nenabled: false')

    const res = await enableProcess('off', ctx)
    expect(res.ok).toBe(true)

    const after = readFileSync(p, 'utf-8')
    expect(after).toContain('enabled: true')
    expect(after).not.toContain('enabled: false')
})

test('disabling a process whose file OMITS `enabled:` DOES write it (it was implicitly enabled)', async () => {
    // The mirror case: disableProcess's `=== "false"` check is already correct, so an implicitly
    // enabled process must still be flipped off. This guards the fix from being over-applied.
    const p = procFile('implicit-off', 'command: sleep')

    const res = await disableProcess('implicit-off', ctx)
    expect(res.ok).toBe(true)
    expect(readFileSync(p, 'utf-8')).toContain('enabled: false')
})

test('enableProcess is idempotent: a second call still leaves the file untouched', async () => {
    const p = procFile('twice', 'command: sleep\nenabled: true')
    await enableProcess('twice', ctx)
    const afterFirst = readFileSync(p, 'utf-8')
    const mtimeFirst = statSync(p).mtimeMs

    await enableProcess('twice', ctx)
    expect(readFileSync(p, 'utf-8')).toBe(afterFirst)
    expect(statSync(p).mtimeMs).toBe(mtimeFirst)
})

// #followup-1: writeProcessFile's pass-through loop writes every frontmatter value bare
// (`${key}: ${value}`). Before this task, parseFrontmatter never unquoted anything, so a
// quoted `name` re-read back into `frontmatter.name` still HELD its own quotes — passing
// them straight through the identity write was safe by construction. Now that
// parseFrontmatter unquotes on read, a naive pass-through would write the plain value back
// bare and corrupt any name that actually needs quoting (a colon, in this case) on the very
// next enable/disable flip. This pins the fix: `name` alone is re-escaped via
// frontmatterValue before writeProcessFile writes it.
test('enableProcess re-quotes a display name that needs it (contains a colon) rather than corrupting it on the next write', async () => {
    const p = procFile(
        'ops-nightly',
        'command: sleep\nname: "Ops: Nightly"\nenabled: false',
    )
    const res = await enableProcess('ops-nightly', ctx)
    expect(res.ok).toBe(true)

    const after = readFileSync(p, 'utf-8')
    expect(after).toContain('enabled: true')
    const { frontmatter } = parseFrontmatter(after)
    expect(frontmatter.name).toBe('Ops: Nightly')
})

test('enableProcess reports a missing definition instead of throwing', async () => {
    const res = await enableProcess('nope', ctx)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('nope')
})

test('a process whose command does not exist is reported failed instead of crashing the daemon', async () => {
    // Before the fix this test does not fail — it takes the whole `bun test` process down with an
    // unhandled 'error' event, which is precisely the daemon-wide crash being fixed.
    mkdirSync(join(processesDir, 'logs'), { recursive: true })
    const ctx2 = {
        processesDir,
        root: processesDir,
        logsDir: join(processesDir, 'logs'),
    } as unknown as VaultContext
    procFile('ghost', 'command: /nonexistent/bin/ghost-daemon\nrestart: always\nenabled: true')

    await startProcesses(ctx2)
    await new Promise(r => setTimeout(r, 400)) // the spawn error arrives on a later tick

    const { processes } = await listProcesses(ctx2)
    const ghost = processes.find(p => p.name === 'ghost')
    expect(ghost?.running).toBe(false)
    expect(ghost?.status).toBe('failed')
    expect(ghost?.error).toContain('ENOENT')
    expect(ghost?.restarts).toBe(0) // a missing binary does not fix itself: no restart loop

    await stopProcessesForVault(ctx2)
})

// #followup-1: `procKey`/pid files/log files must be keyed by the def's FILE slug
// (`web-search`, from `web-search.md`), never its display name (`name: "Web Search"`
// in frontmatter) — the two can differ, and every external caller (HTTP/CLI/MCP)
// already addresses a process by its file basename. This pins the whole chain: a
// running child started under a display-named def writes its pid/log files under
// the slug, and disableProcess (looked up by slug) actually stops the live child.
test('disableProcess stops a running child keyed by the FILE slug, never the display name — pid/log paths use the slug too', async () => {
    const logsDir = join(processesDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const ctx2 = {
        processesDir,
        root: processesDir,
        logsDir,
    } as unknown as VaultContext

    procFile(
        'web-search',
        'command: sleep\nargs: ["100"]\nname: "Web Search"\nrestart: never\nenabled: true',
    )

    await startProcesses(ctx2)
    await new Promise(r => setTimeout(r, 200)) // let the spawn land

    const before = (await listProcesses(ctx2)).processes.find(
        p => p.name === 'Web Search',
    )
    expect(before?.running).toBe(true)
    const pid = before!.pid!

    // pid + log files are named by the file slug, never the display name.
    expect(
        readFileSync(join(processesDir, '.pids', 'web-search.pid'), 'utf-8'),
    ).toBe(String(pid))
    expect(() =>
        statSync(join(processesDir, '.pids', 'Web Search.pid')),
    ).toThrow()
    expect(() =>
        statSync(join(logsDir, 'web-search.stdout.log')),
    ).not.toThrow()

    const res = await disableProcess('web-search', ctx2)
    expect(res.ok).toBe(true)

    await new Promise(r => setTimeout(r, 300)) // SIGTERM + exit handler settle

    const after = (await listProcesses(ctx2)).processes.find(
        p => p.name === 'Web Search',
    )
    expect(after?.running).toBe(false)

    const raw = readFileSync(join(processesDir, 'web-search.md'), 'utf-8')
    expect(raw).toContain('enabled: false')
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.name).toBe('Web Search')

    await stopProcessesForVault(ctx2)
})
