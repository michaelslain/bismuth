import { test as bunTest, expect } from 'bun:test'
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
