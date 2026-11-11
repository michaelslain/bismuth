import { test as bunTest, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { pageCountOf, pdfOfBars as pdf, pdfOfWidths } from '../../core/test/pdfFixtures'

// Spawns the real CLI: `pdf merge` plans, `--write` writes.
const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 60_000)
const CLI = join(import.meta.dir, '..', 'src', 'index.ts')

async function run(args: string[], vault: string) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    const proc = Bun.spawn(['bun', 'run', CLI, ...args, '--vault', vault], { env, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { code, stdout, stderr }
}

test('pdf merge prints the plan, then --write merges it', async () => {
    const vault = makeVault({
        'n.pdf.md': '<!-- bismuth:transcript:start -->\n### Page 1\n\none\n\n### Page 2\n\ntwo\n<!-- bismuth:transcript:end -->\n',
    })
    writeFileSync(join(vault, 'n.pdf'), await pdf([{ id: 1 }, { id: 2 }]))
    writeFileSync(join(vault, 'n2.pdf'), await pdf([{ id: 1 }, { id: 2, extra: true }, { id: 3 }]))

    const plan = await run(['pdf', 'merge', 'n.pdf', 'n2.pdf'], vault)
    expect(plan.code).toBe(0)
    const p = JSON.parse(plan.stdout)
    expect([p.kept, p.updated, p.added, p.only, p.pages]).toEqual([1, 1, 1, 0, 3])
    expect((await pageCountOf(join(vault, 'n.pdf')))).toBe(2)

    const wrote = await run(['pdf', 'merge', 'n.pdf', 'n2.pdf', '--write'], vault)
    expect(wrote.code).toBe(0)
    expect((await pageCountOf(join(vault, 'n.pdf')))).toBe(3)
    expect(readFileSync(join(vault, 'n.pdf.md'), 'utf8')).toContain('### Page 1\n\none')
    expect(readFileSync(join(vault, 'n.pdf.md'), 'utf8')).not.toContain('two')
})

test('pdf merge pairs by order a pdf that shares no page', async () => {
    const vault = makeVault({})
    writeFileSync(join(vault, 'n.pdf'), await pdf([{ id: 1 }]))
    writeFileSync(join(vault, 'x.pdf'), await pdfOfWidths([400]))
    const r = await run(['pdf', 'merge', 'n.pdf', 'x.pdf'], vault)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ steps: [{ kind: 'update', page: 0, from: 0 }], kept: 0, updated: 1 })
})
