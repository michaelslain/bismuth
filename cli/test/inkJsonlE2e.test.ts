import { test as bunTest, expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import {
    parseDoc,
    roundDoc,
    serializeDoc,
    emptyDoc,
} from '../../core/src/drawing/model'
import type { DrawingDoc, Stroke } from '../../core/src/drawing/model'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 180_000)

type Run = { code: number; stdout: string; stderr: string }

async function cli(vault: string, ...args: string[]): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    delete env.BISMUTH_APP_PATH
    env.BISMUTH_GCAL_DIR =
        process.env.BISMUTH_GCAL_DIR ??
        mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            join(REPO_ROOT, 'cli/src/index.ts'),
            ...args,
            '--vault',
            vault,
        ],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

const ok = (r: Run) => {
    expect(r.code, r.stderr).toBe(0)
    return r
}

function stroke(seed: number): Stroke {
    const pts: number[] = []
    for (let i = 0; i < 12; i++)
        pts.push(40 + seed * 7 + i * 13, 60 + ((seed * 31 + i * 17) % 900), 128)
    return { t: seed % 5 === 0 ? 'hl' : 'pen', c: '#e5e5e5', w: 2, pts }
}

/** A 69-page paper annotation sidecar: ink on some pages, others left blank. */
function paperDoc(): DrawingDoc {
    const pages = Array.from({ length: 69 }, (_, i) => ({
        strokes: i % 4 === 0 ? [stroke(i), stroke(i + 1)] : [],
    }))
    pages[0].strokes.push(stroke(99))
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'grid' },
        pages,
        margin: { right: 0.25 },
    }
}

function vaultWith(files: Record<string, string>): string {
    return makeVault(files)
}

const png = (vault: string, name: string) => readFileSync(join(vault, name))

test('1: a 69-page single-object paper.pdf.draw renders byte-identical to its JSON Lines form', async () => {
    const doc = paperDoc()
    const single = JSON.stringify(roundDoc(doc))
    const jsonl = serializeDoc(doc)
    expect(jsonl.trimEnd().split('\n').length).toBeGreaterThan(1)
    expect(jsonl.trimEnd().split('\n').length).toBeLessThan(71)
    const vault = vaultWith({
        'single.pdf.draw': single,
        'lines.pdf.draw': jsonl,
    })
    ok(
        await cli(
            vault,
            'render',
            join(vault, 'single.pdf.draw'),
            '--out',
            join(vault, 'single.png'),
        ),
    )
    ok(
        await cli(
            vault,
            'render',
            join(vault, 'lines.pdf.draw'),
            '--out',
            join(vault, 'lines.png'),
        ),
    )
    const a = png(vault, 'single.png')
    const b = png(vault, 'lines.png')
    expect(a.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(a.length).toBeGreaterThan(1000)
    expect(b.equals(a)).toBe(true)
    // the in-process parse agrees too
    expect(parseDoc(jsonl)).toEqual(parseDoc(single))
})

test('2: render and export both accept a JSON Lines .draw', async () => {
    const jsonl = serializeDoc(paperDoc())
    const vault = vaultWith({ 'Sketch.draw': jsonl })
    const file = join(vault, 'Sketch.draw')
    const r = ok(
        await cli(vault, 'render', file, '--out', join(vault, 'r.png')),
    )
    expect(r.stdout).toContain('wrote')
    ok(
        await cli(
            vault,
            'export',
            file,
            '--format',
            'png',
            '--out',
            join(vault, 'e.png'),
        ),
    )
    const rp = png(vault, 'r.png')
    const ep = png(vault, 'e.png')
    expect(rp.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(ep.equals(rp)).toBe(true)
})

test('3: a standalone Sketch.draw round-trips', async () => {
    const doc: DrawingDoc = {
        ...emptyDoc(),
        pages: [
            { strokes: [stroke(1), stroke(2)] },
            { strokes: [] },
            { strokes: [stroke(3)] },
        ],
    }
    const text = serializeDoc(doc)
    // serialising the parse of a serialisation is a fixed point
    expect(serializeDoc(parseDoc(text))).toBe(text)
    expect(parseDoc(text)).toEqual(roundDoc(doc))
    // and it survives a trip through disk + the CLI renderer
    const vault = vaultWith({ 'Sketch.draw': text })
    const before = readFileSync(join(vault, 'Sketch.draw'), 'utf8')
    ok(
        await cli(
            vault,
            'render',
            join(vault, 'Sketch.draw'),
            '--out',
            join(vault, 's.png'),
        ),
    )
    expect(readFileSync(join(vault, 'Sketch.draw'), 'utf8')).toBe(before)
    writeFileSync(join(vault, 'again.draw'), serializeDoc(parseDoc(before)))
    expect(readFileSync(join(vault, 'again.draw'), 'utf8')).toBe(before)
})

test('a 0-byte .draw renders and exports as a blank png', async () => {
    const vault = vaultWith({ 'New.draw': '' })
    const file = join(vault, 'New.draw')
    const png = (p: string) =>
        expect(readFileSync(p).subarray(1, 4).toString()).toBe('PNG')
    ok(await cli(vault, 'render', file, '--out', join(vault, 'r.png')))
    png(join(vault, 'r.png'))
    ok(await cli(vault, 'export', file, '--out', join(vault, 'e.png')))
    png(join(vault, 'e.png'))
})
