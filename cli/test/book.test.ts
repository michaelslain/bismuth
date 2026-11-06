// cli/test/book.test.ts — `transcribe` and `book pages` run in-process against a temp vault,
// with the engines swapped through setTranscribeEngines (nothing spawns the helper or an agent).
import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../src/registry'
import { setTranscribeEngines } from '../../core/src/transcribe'

let vault: string
const BASE = [
    '{"type":"base","view":"book"}',
    '{"page":"[[p2.png]]"}',
    '{"page":"[[p1.png]]"}',
    '{"page":"notes.txt"}',
    '',
].join('\n')

beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'book-cli-'))
    writeFileSync(join(vault, 'a.png'), 'x')
    writeFileSync(join(vault, 'Book.base.jsonl'), BASE)
    delete process.env.BISMUTH_AGENT_CHANNEL
    delete process.env.BISMUTH_MCP_CHANNEL
})
afterEach(() => {
    setTranscribeEngines(null)
    rmSync(vault, { recursive: true, force: true })
})

async function run(phrase: string, args: string[]) {
    const lines: string[] = []
    const errs: string[] = []
    const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errs.push(a.join(' ')))
    const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`)
    }) as never)
    let code: number | null = 0
    try {
        await registry[phrase].run([...args, '--vault', vault])
    } catch (e) {
        const m = /^exit:(\d+)$/.exec((e as Error).message)
        code = m ? Number(m[1]) : 1
        if (!m) errs.push((e as Error).message)
    } finally {
        log.mockRestore()
        err.mockRestore()
        exit.mockRestore()
    }
    return { stdout: lines.join('\n'), stderr: errs.join('\n'), code }
}

test('transcribe --engine ai writes the companion through the core path', async () => {
    const seen: unknown[] = []
    setTranscribeEngines({
        ai: async (abs, kind, pages) => {
            seen.push([abs, kind, pages])
            return [{ page: 1, text: 'inked words' }]
        },
    })
    const r = await run('transcribe', ['a.png', '--engine', 'ai', '--book', 'Notebook'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, companion: 'a.png.md', engine: 'ai' })
    expect(seen).toEqual([[join(vault, 'a.png'), 'image', undefined]])
    const md = readFileSync(join(vault, 'a.png.md'), 'utf8')
    expect(md).toContain('inked words')
    expect(md).toContain('transcribed: ai')
    expect(md).toContain('[[Notebook]]')
})

test('transcribe --pages expands ranges and --missing skips a transcribed page', async () => {
    let runs = 0
    const pagesSeen: (number[] | undefined)[] = []
    setTranscribeEngines({
        onDevice: async (_abs, _kind, pages) => {
            runs++
            pagesSeen.push(pages)
            return [{ page: 1, text: 't' }]
        },
    })
    await run('transcribe', ['a.png', '--pages', '1-3,7'])
    expect(pagesSeen).toEqual([[1, 2, 3, 7]])
    const r = await run('transcribe', ['a.png', '--missing'])
    expect(JSON.parse(r.stdout)).toMatchObject({ skipped: true, pages: [] })
    expect(runs).toBe(1)
})

test('transcribe refuses a note, a missing file and a bad engine', async () => {
    writeFileSync(join(vault, 'n.md'), '# n\n')
    expect((await run('transcribe', ['n.md'])).code).not.toBe(0)
    expect((await run('transcribe', ['gone.png'])).stderr).toContain('no such file')
    const bad = await run('transcribe', ['a.png', '--engine', 'bogus'])
    expect(bad.code).not.toBe(0)
    expect(bad.stderr).toContain('auto, on-device, marker or ai')
})

test('transcribe treats a hidden page as missing for an agent', async () => {
    writeFileSync(join(vault, 'h.png'), 'x')
    writeFileSync(join(vault, 'h.png.md'), '---\nvisibility: hidden\n---\n')
    setTranscribeEngines({ onDevice: async () => [{ page: 1, text: 'secret' }] })
    process.env.BISMUTH_AGENT_CHANNEL = 'chat'
    const r = await run('transcribe', ['h.png'])
    expect(r.stderr).toContain('no such file')
    expect(readFileSync(join(vault, 'h.png.md'), 'utf8')).not.toContain('secret')
})

test('book pages lists nothing when the source reads a hidden base', async () => {
    writeFileSync(join(vault, 'a.png.md'), 'scan')
    writeFileSync(
        join(vault, 'Hidden.base.jsonl'),
        '{"type":"base","view":"table","visibility":"hidden","source":{"kind":"notes","where":"file.path.endsWith(\\"png.md\\")"}}\n',
    )
    writeFileSync(
        join(vault, 'Front.base.jsonl'),
        '{"type":"base","view":"book","source":{"kind":"base","ref":"[[Hidden]]"}}\n',
    )
    const owner = await run('book pages', ['Front.base.jsonl'])
    expect(owner.stdout).toBe('a.png')
    process.env.BISMUTH_AGENT_CHANNEL = 'chat'
    const r = await run('book pages', ['Front.base.jsonl'])
    expect(r.stdout).toBe('')
})

test('book pages follows the base sort', async () => {
    writeFileSync(
        join(vault, 'Sorted.base.jsonl'),
        [
            '{"type":"base","view":"book","sort":[{"property":"page","direction":"DESC"}]}',
            '{"page":"[[p1.png]]"}',
            '{"page":"[[p3.png]]"}',
            '{"page":"[[p2.png]]"}',
            '',
        ].join('\n'),
    )
    const r = await run('book pages', ['Sorted.base.jsonl'])
    expect(r.stdout).toBe('p3.png\np2.png\np1.png')
})

test('book pages prints the page files in row order and --json prints the refs', async () => {
    const r = await run('book pages', ['Book.base.jsonl'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('p2.png\np1.png')
    const j = await run('book pages', ['Book.base.jsonl', '--json'])
    expect(JSON.parse(j.stdout).map((x: { file: string }) => x.file)).toEqual(['p2.png', 'p1.png'])
})
