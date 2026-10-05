import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../src/registry'
import { MEMORY_UNAVAILABLE } from '../../mcp/src/memory'

// The `docs` and `memory` groups run IN-PROCESS here (no subprocess): console.log is captured and
// process.exit is turned into a throw, so a failing command is observable without killing the runner.

let root: string
let docsDir: string
let memDir: string
const saved: Record<string, string | undefined> = {}
const ENV = ['BISMUTH_DOCS_DIR', 'BISMUTH_MEMORY_DIR', 'BISMUTH_VAULT']

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docs-memory-'))
    docsDir = join(root, 'docs')
    memDir = join(root, 'memory')
    mkdirSync(join(docsDir, 'topic'), { recursive: true })
    writeFileSync(join(docsDir, 'topic', 'alpha.md'), '# Alpha page\n\nintro about zebras\n\n## Stripes\n\nzebra stripes are unique\n')
    for (const k of ENV) {
        saved[k] = process.env[k]
        delete process.env[k]
    }
    process.env.BISMUTH_DOCS_DIR = docsDir
})

afterEach(() => {
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
    rmSync(root, { recursive: true, force: true })
})

/** Run a registered command in-process; returns what it printed, or the thrown exit. */
async function run(phrase: string, args: string[]): Promise<{ stdout: string; stderr: string; exit: number | null }> {
    const lines: string[] = []
    const errs: string[] = []
    const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errs.push(a.join(' ')))
    const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`)
    }) as never)
    let code: number | null = null
    try {
        await registry[phrase].run(args)
    } catch (e) {
        const m = /^exit:(\d+)$/.exec(e instanceof Error ? e.message : '')
        if (!m) throw e
        code = Number(m[1])
    } finally {
        log.mockRestore()
        err.mockRestore()
        exit.mockRestore()
    }
    return { stdout: lines.join('\n'), stderr: errs.join('\n'), exit: code }
}

test('docs list prints every page as {path, title}', async () => {
    const r = await run('docs list', [])
    expect(JSON.parse(r.stdout)).toEqual([{ path: 'topic/alpha.md', title: 'Alpha page' }])
})

test('docs search prints ranked hits and honours --limit', async () => {
    const r = await run('docs search', ['zebra', 'stripes'])
    const hits = JSON.parse(r.stdout)
    expect(hits[0].path).toBe('topic/alpha.md#stripes')
    const one = JSON.parse((await run('docs search', ['zebra', '--limit', '1'])).stdout)
    expect(one).toHaveLength(1)
})

test('docs read prints the page raw, or one section', async () => {
    expect((await run('docs read', ['topic/alpha.md'])).stdout).toContain('intro about zebras')
    const sec = await run('docs read', ['topic/alpha.md', '--section', 'Stripes'])
    expect(sec.stdout).toContain('zebra stripes are unique')
    expect(sec.stdout).not.toContain('intro about zebras')
})

test('docs read of a missing page fails non-zero', async () => {
    const r = await run('docs read', ['nope.md'])
    expect(r.exit).toBe(1)
    expect(r.stderr).toContain('Doc not found')
})

test('memory remember -> recall finds it -> forget -> recall is empty', async () => {
    const m = ['--memory', memDir]
    const saved = await run('memory remember', ['--name', 'zebra-fact', '--content', 'zebras are striped', '--tags', 'animal,fact', ...m])
    expect(JSON.parse(saved.stdout)).toEqual({ ok: true, name: 'zebra-fact' })

    const found = JSON.parse((await run('memory recall', ['striped', ...m])).stdout)
    expect(found.count).toBe(1)
    expect(found.notes[0].name).toBe('zebra-fact')

    const gone = JSON.parse((await run('memory forget', ['zebra-fact', ...m])).stdout)
    expect(gone).toEqual({ ok: true, name: 'zebra-fact' })

    expect(JSON.parse((await run('memory recall', ['striped', ...m])).stdout).count).toBe(0)
})

test('memory uses BISMUTH_MEMORY_DIR when --memory is absent', async () => {
    process.env.BISMUTH_MEMORY_DIR = memDir
    await run('memory remember', ['--name', 'env-note', '--content', 'from env'])
    expect(JSON.parse((await run('memory recall', ['from env'])).stdout).count).toBe(1)
})

test('memory remember needs --name and --content', async () => {
    const r = await run('memory remember', ['--name', 'x', '--memory', memDir])
    expect(r.exit).toBe(1)
    expect(r.stderr).toContain('--content')
})

test('memory is unavailable when no dir resolves', async () => {
    // a vault with no daemon.enabled, and no --memory / BISMUTH_MEMORY_DIR
    const vault = join(root, 'vault')
    mkdirSync(vault)
    writeFileSync(join(vault, '.settings'), '# empty\n')
    process.env.BISMUTH_VAULT = vault
    const r = await run('memory recall', ['anything'])
    expect(r.exit).toBe(1)
    expect(r.stderr).toContain(MEMORY_UNAVAILABLE)
})

test('memory resolves <vault>/.daemon/memory when the vault enables the daemon', async () => {
    const vault = join(root, 'vault2')
    mkdirSync(vault)
    writeFileSync(join(vault, '.settings'), 'daemon:\n  enabled: true\n')
    await run('memory remember', ['--name', 'v-note', '--content', 'vault scoped', '--vault', vault])
    expect(JSON.parse((await run('memory recall', ['vault scoped', '--vault', vault])).stdout).count).toBe(1)
})
