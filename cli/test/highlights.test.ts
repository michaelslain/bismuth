import { test as bunTest, expect } from 'bun:test'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'

// Spawns the real CLI, as the owner and as the daemon's agent shell.
const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 30_000)
const CLI = join(import.meta.dir, '..', 'src', 'index.ts')

async function run(args: string[], vault: string, agent = false) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    if (agent) env.BISMUTH_AGENT_CHANNEL = 'daemon'
    const proc = Bun.spawn(['bun', 'run', CLI, ...args, '--vault', vault], {
        env,
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

const SIDECAR = [
    '{"v":1,"kind":"drawing","paper":{"bg":"blank"},"pageCount":3}',
    '{"page":2,"strokes":[],"highlights":[{"id":"b","c":"hl","rects":[{"x":10,"y":600,"w":90,"h":15}],"text":"later on the page"},{"id":"a","c":"#FF00AA","rects":[{"x":10,"y":100,"w":90,"h":15}],"text":"noto-\\nriously piecemeal"}]}',
    '',
].join('\n')

const files = () => ({
    'papers/x.pdf': '%PDF-1.4',
    'papers/x.pdf.draw': SIDECAR,
    'papers/plain.pdf': '%PDF-1.4',
    'papers/secret.pdf': '%PDF-1.4',
    'papers/secret.pdf.draw': SIDECAR,
    'papers/secret.pdf.md': '---\nvisibility: hidden\n---\n',
})

test('prints highlighted text by 1-based page in reading order', async () => {
    const r = await run(['highlights', 'papers/x.pdf'], makeVault(files()), true)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(
        'papers/x.pdf: 2 highlights\n\np. 3\n- notoriously piecemeal\n- later on the page\n',
    )
})

test('--json carries page, colour and text; the sidecar path works too', async () => {
    const r = await run(['highlights', 'papers/x.pdf.draw', '--json'], makeVault(files()))
    const body = JSON.parse(r.stdout)
    expect(body.path).toBe('papers/x.pdf')
    expect(body.count).toBe(2)
    expect(body.highlights[0]).toEqual({
        page: 3,
        id: 'a',
        color: '#FF00AA',
        text: 'notoriously piecemeal',
        store: 'sidecar',
    })
})

test('a PDF with no sidecar has 0 highlights; a missing PDF fails', async () => {
    const vault = makeVault(files())
    expect((await run(['highlights', 'papers/plain.pdf'], vault)).stdout).toBe(
        'papers/plain.pdf: 0 highlights\n',
    )
    expect((await run(['highlights', 'papers/none.pdf'], vault)).code).not.toBe(0)
})

test('an agent is refused a hidden PDF and its sidecar', async () => {
    const vault = makeVault(files())
    for (const path of ['papers/secret.pdf', 'papers/secret.pdf.draw']) {
        const r = await run(['highlights', path], vault, true)
        expect(r.code, path).not.toBe(0)
        expect(r.stdout + r.stderr, path).not.toContain('piecemeal')
    }
})

// --- highlights stored in the PDF itself ---
const FIX = join(import.meta.dir, '..', '..', 'core', 'test', 'drawing', 'fixtures')

// The same two highlights on page 1, which the one-page fixture PDF has.
const SIDECAR_P1 = SIDECAR.replace('"page":2', '"page":0')

function pdfVault(sidecar?: string, pdf = 'pdfkit-highlights.pdf'): string {
    const vault = makeVault(sidecar ? { 'p/a.pdf.draw': sidecar } : {})
    mkdirSync(join(vault, 'p'), { recursive: true })
    copyFileSync(join(FIX, pdf), join(vault, 'p/a.pdf'))
    return vault
}

test('lists the highlights a PDF carries itself, with their text and store', async () => {
    const r = await run(['highlights', 'p/a.pdf', '--json'], pdfVault())
    const body = JSON.parse(r.stdout)
    expect(body.count).toBe(7)
    expect(body.highlights.every((h: { store: string }) => h.store === 'pdf')).toBe(true)
    expect(body.highlights[0].page).toBe(1)
    expect(body.highlights[0].color).toMatch(/^#/)
    expect(body.highlights[0].text).toBe('Hello highlighted w')
    const plain = await run(['highlights', 'p/a.pdf'], pdfVault())
    expect(plain.stdout).toContain('p/a.pdf: 7 highlights\n\np. 1\n- Hello highlighted w')
})

test('a mixed PDF and sidecar lists both, marked by store', async () => {
    const r = await run(['highlights', 'p/a.pdf', '--json'], pdfVault(SIDECAR_P1))
    const body = JSON.parse(r.stdout)
    expect(body.count).toBe(9)
    const stores = body.highlights.map((h: { store: string }) => h.store)
    expect(stores.filter((s: string) => s === 'pdf')).toHaveLength(7)
    expect(stores.filter((s: string) => s === 'sidecar')).toHaveLength(2)
    expect(body.highlights.every((h: { page: number }) => h.page === 1)).toBe(true)
})

test('migrate moves sidecar highlights into the PDF', async () => {
    const vault = pdfVault(SIDECAR_P1)
    const m = await run(['highlights', 'migrate', 'p/a.pdf'], vault)
    expect(m.code, m.stderr).toBe(0)
    expect(m.stdout.trim()).toBe('p/a.pdf: moved 2')
    const body = JSON.parse((await run(['highlights', 'p/a.pdf', '--json'], vault)).stdout)
    expect(body.highlights.filter((h: { store: string }) => h.store === 'sidecar')).toHaveLength(0)
    expect(readFileSync(join(vault, 'p/a.pdf.draw'), 'utf8')).not.toContain('piecemeal')
})

test('migrate --all handles every PDF whose sidecar has highlights', async () => {
    const vault = pdfVault(SIDECAR_P1)
    writeFileSync(join(vault, 'p/none.pdf'), '%PDF-1.4')
    copyFileSync(join(FIX, 'encrypted.pdf'), join(vault, 'p/enc.pdf'))
    writeFileSync(join(vault, 'p/enc.pdf.draw'), SIDECAR_P1)
    const m = await run(['highlights', 'migrate', '--all'], vault)
    expect(m.code, m.stderr).toBe(0)
    expect(m.stdout.trim().split('\n')).toEqual([
        'p/a.pdf: moved 2',
        'p/enc.pdf: kept in sidecar (encrypted)',
    ])
})

test('migrate on an encrypted PDF keeps the sidecar', async () => {
    const vault = pdfVault(SIDECAR_P1, 'encrypted.pdf')
    const m = await run(['highlights', 'migrate', 'p/a.pdf'], vault)
    expect(m.stdout.trim()).toBe('p/a.pdf: kept in sidecar (encrypted)')
    expect(readFileSync(join(vault, 'p/a.pdf.draw'), 'utf8')).toContain('piecemeal')
})

test('an agent is refused migrating a hidden PDF', async () => {
    const vault = makeVault(files())
    const r = await run(['highlights', 'migrate', 'papers/secret.pdf'], vault, true)
    expect(r.code).not.toBe(0)
    expect(readFileSync(join(vault, 'papers/secret.pdf.draw'), 'utf8')).toContain('piecemeal')
})
