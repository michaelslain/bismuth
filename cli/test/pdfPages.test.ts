import { test as bunTest, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { pdfOfWidths, widthsOf } from '../../core/test/pdfFixtures'

// Spawns the real CLI: `pdf pages` and `transcript set`.
const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 30_000)
const CLI = join(import.meta.dir, '..', 'src', 'index.ts')

async function run(args: string[], vault: string, stdin?: string) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    const proc = Bun.spawn(['bun', 'run', CLI, ...args, '--vault', vault], {
        env,
        stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

async function vaultWithPdf() {
    const vault = makeVault({
        'p.pdf.md': '---\ntranscribed: ai\n---\n<!-- bismuth:transcript:start -->\n### Page 1\n\none\n\n### Page 2\n\ntwo\n<!-- bismuth:transcript:end -->\n',
    })
    writeFileSync(join(vault, 'p.pdf'), await pdfOfWidths([101, 102, 103]))
    return vault
}

test('pdf pages prints the count, then rewrites to the order', async () => {
    const vault = await vaultWithPdf()
    const count = await run(['pdf', 'pages', 'p.pdf'], vault)
    expect(JSON.parse(count.stdout)).toEqual({ pages: 3 })
    const r = await run(['pdf', 'pages', 'p.pdf', '--order', '3,1,blank,2'], vault)
    expect(r.stderr).toBe('')
    expect(JSON.parse(r.stdout)).toEqual({ pages: 4 })
    expect(await widthsOf(join(vault, 'p.pdf'))).toEqual([103, 101, 101, 102])
    const md = readFileSync(join(vault, 'p.pdf.md'), 'utf8')
    expect(md).toContain('### Page 2\n\none')
    expect(md).toContain('### Page 4\n\ntwo')
    expect(md).not.toContain('### Page 1')
})

test('pdf pages refuses a bad order and a missing pdf', async () => {
    const vault = await vaultWithPdf()
    const bad = await run(['pdf', 'pages', 'p.pdf', '--order', '1,zebra'], vault)
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('zebra')
    const missing = await run(['pdf', 'pages', 'nope.pdf', '--order', '1'], vault)
    expect(missing.code).not.toBe(0)
})

test('transcript set writes one page from --text or --stdin', async () => {
    const vault = await vaultWithPdf()
    const a = await run(['transcript', 'set', 'p.pdf', '--page', '2', '--text', 'by hand ==x=='], vault)
    expect(JSON.parse(a.stdout)).toEqual({ ok: true, companion: 'p.pdf.md', page: 2 })
    const b = await run(['transcript', 'set', 'p.pdf', '--page', '3', '--stdin'], vault, 'from stdin\nsecond line')
    expect(b.code).toBe(0)
    const md = readFileSync(join(vault, 'p.pdf.md'), 'utf8')
    expect(md).toContain('transcribed: ai')
    expect(md).toContain('by hand ==x==')
    expect(md).toContain('### Page 3\n\nfrom stdin\nsecond line')
    expect(md).toContain('one')
    const neither = await run(['transcript', 'set', 'p.pdf', '--page', '1'], vault)
    expect(neither.code).toBe(1)
})
