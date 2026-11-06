import { test, expect, afterAll, afterEach, spyOn } from 'bun:test'
import * as memory from '@bismuth/memory'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createSemanticChannel, QUERY_PREFIX } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import {
    configureVaultEmbed,
    isSemanticUnavailable,
    syncVaultEmbeddings,
    vaultSemanticNeighbours,
    vaultSemanticSearch,
    vaultSourceHits,
} from '../src/vaultEmbed'
import { configureParsedNotes } from '../src/parsedNotes'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => {
    configureVaultEmbed()
    configureParsedNotes()
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fake model: a 3-d one-hot by topic word. Deterministic, unit length.
const vecOf = (t: string) => (t.includes('beta') ? [0, 1, 0] : t.includes('gamma') ? [0, 0, 1] : [1, 0, 0])

function fixture(opts: { enabled?: boolean; slowEmbed?: boolean } = {}) {
    const vault = tempDir('vault-')
    const vectors = tempDir('vv-')
    const calls = { embed: 0, texts: [] as string[] }
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), body)
    }
    if (opts.enabled !== false) put('.settings', 'embeddings:\n  enabled: true\n')
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.embed++
            calls.texts.push(...texts)
            if (opts.slowEmbed) await sleep(200)
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    configureVaultEmbed({ channel, vectorsDir: vectors, syncDebounceMs: 10, storeDebounceMs: 10 })
    return { vault, vectors, calls, put, channel }
}

/** Search until the background pass has embedded something. */
async function settled(f: () => ReturnType<typeof vaultSemanticSearch>) {
    for (let i = 0; i < 60; i++) {
        const r = await f()
        if (!isSemanticUnavailable(r)) return r
        await sleep(100)
    }
    throw new Error('never settled')
}

test('switch off: unavailable "off" naming embeddings.enabled, and zero embed calls', async () => {
    const f = fixture({ enabled: false })
    f.put('a.md', '# a\nbeta text')
    const r = await vaultSemanticSearch(f.vault, 'beta')
    expect(isSemanticUnavailable(r) && r.unavailable).toBe('off')
    expect(isSemanticUnavailable(r) && r.message).toContain('embeddings.enabled')
    syncVaultEmbeddings(f.vault)
    expect(await vaultSemanticNeighbours(f.vault, 'a.md')).toMatchObject({ unavailable: 'off' })
    await sleep(100)
    expect(f.calls.embed).toBe(0)
})

test('a binary that cannot host the worker answers no-worker', async () => {
    const f = fixture()
    const channel = createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' })
    configureVaultEmbed({ channel, vectorsDir: f.vectors })
    expect(await vaultSemanticSearch(f.vault, 'beta')).toMatchObject({ unavailable: 'no-worker' })
})

test('ranking: the note sharing the query vector ranks first, with a bounded excerpt', async () => {
    const f = fixture()
    f.put('a.md', '# alpha note\nplain alpha words')
    f.put('b.md', '# beta note\n' + 'beta words '.repeat(100))
    f.put('sub/c.md', '# gamma note\ngamma words')
    const r = await settled(() => vaultSemanticSearch(f.vault, 'beta please', { waitMs: 2000 }))
    expect(r[0]!.path).toBe('b.md')
    expect(r[0]!.score).toBeCloseTo(1)
    expect(r[0]!.excerpt.length).toBeLessThanOrEqual(300)
    expect(r.map(h => h.path).sort()).toEqual(['a.md', 'b.md', 'sub/c.md'])
})

test('chunks lead with path, title and tags; .daemon and dot dirs are not indexed', async () => {
    const f = fixture()
    f.put('notes/x.md', '---\ntags: [zeta]\n---\n# The X title\nbody beta')
    f.put('.daemon/memory/m.md', 'beta secret')
    f.put('.hidden/h.md', 'beta hidden')
    const r = await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    expect(r.map(h => h.path)).toEqual(['notes/x.md'])
    const doc = f.calls.texts.find(t => t.includes('body beta'))!
    expect(doc.startsWith('notes/x.md\nThe X title\nzeta\n')).toBe(true)
})

test('an image transcript indexes without its markers or highlight marks', async () => {
    const f = fixture()
    f.put('s.png', 'png-bytes')
    f.put('s.png.md', '---\ntranscribed: on-device\n---\n<!-- bismuth:transcript:start -->\nbody beta ==milk==\n<!-- bismuth:transcript:end -->\n')
    const r = await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    expect(r.map(h => h.path)).toEqual(['s.png'])
    expect(r[0].excerpt).not.toContain('<!--')
    expect(r[0].excerpt).not.toContain('==')
    const doc = f.calls.texts.find(t => t.includes('body beta'))!
    expect(doc).not.toContain('<!--')
    expect(doc).toContain('milk')
    expect(doc).not.toContain('==')
})

test('a scanned PDF is found by its transcript, page by page, where it has no text layer', async () => {
    const f = fixture()
    f.put('scan.pdf', '%PDF-1.4 not really a pdf')
    f.put(
        'scan.pdf.md',
        '---\ntranscribed: marker\n---\n<!-- bismuth:transcript:start -->\n### Page 1\nalpha notes\n\n### Page 2\nthe beta ==lemma== proof\n<!-- bismuth:transcript:end -->\n',
    )
    const r = await sources(f, 'beta')
    expect(r[0]).toMatchObject({ kind: 'pdf', id: 'scan.pdf', page: 2 })
    const doc = f.calls.texts.find(t => t.includes('lemma'))!
    expect(doc).not.toContain('==')
    expect(doc).not.toContain('<!--')
})

test('deny filters before k: a hidden best match never appears and k visible hits return', async () => {
    const f = fixture()
    f.put('private/best.md', 'beta beta beta')
    for (const n of ['a', 'b', 'c']) f.put(`${n}.md`, `alpha ${n}`)
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const deny = [{ rel: 'private/best.md', abs: join(f.vault, 'private/best.md') }]
    const r = (await vaultSemanticSearch(f.vault, 'beta', { k: 2, deny, waitMs: 2000 })) as { path: string }[]
    expect(r.length).toBe(2)
    expect(r.some(h => h.path === 'private/best.md')).toBe(false)
    const open = (await vaultSemanticSearch(f.vault, 'beta', { k: 2, waitMs: 2000 })) as { path: string }[]
    expect(open[0]!.path).toBe('private/best.md')
})

test('neighbours exclude the note itself; an unknown note is []', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'beta two')
    f.put('c.md', 'alpha three')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const n = (await vaultSemanticNeighbours(f.vault, 'a.md', { k: 5 })) as { path: string }[]
    expect(n.map(h => h.path)).toEqual(['b.md', 'c.md'])
    expect(await vaultSemanticNeighbours(f.vault, 'nope.md')).toEqual([])
})

test('neighbours of a denied anchor note are []', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'beta two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const deny = [{ rel: 'a.md', abs: join(f.vault, 'a.md') }]
    expect(await vaultSemanticNeighbours(f.vault, 'a.md', { deny })).toEqual([])
})

test('a restart embeds nothing unchanged; an edit re-embeds only that note; a deletion prunes', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'alpha two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)
    const docsFirst = f.calls.texts.filter(t => t.includes('one') || t.includes('two')).length
    expect(docsFirst).toBe(2)

    // "restart": a fresh state over the same vectors dir
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, syncDebounceMs: 10, storeDebounceMs: 10 })
    f.calls.texts.length = 0
    const again = await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    expect(again[0]!.path).toBe('a.md')
    await sleep(300)
    expect(f.calls.texts.filter(t => !t.startsWith('Represent'))).toEqual([])

    f.put('b.md', 'alpha two edited')
    syncVaultEmbeddings(f.vault, ['b.md'])
    await sleep(400)
    expect(f.calls.texts.filter(t => !t.startsWith('Represent')).length).toBe(1)

    rmSync(join(f.vault, 'a.md'))
    syncVaultEmbeddings(f.vault, ['a.md'])
    await sleep(400)
    const after = (await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })) as { path: string }[]
    expect(after.map(h => h.path)).toEqual(['b.md'])
}, 20_000)

test('while nothing is embedded yet the answer is warming, not an empty list', async () => {
    const f = fixture({ slowEmbed: true })
    f.put('a.md', 'beta one')
    const r = await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })
    expect(r).toMatchObject({ unavailable: 'warming' })
})

test('edits and deletions made while the switch is off show up once it is back on', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'alpha two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)

    f.put('.settings', 'embeddings:\n  enabled: false\n')
    syncVaultEmbeddings(f.vault)
    f.put('b.md', 'gamma three edited')
    rmSync(join(f.vault, 'a.md'))
    syncVaultEmbeddings(f.vault, ['b.md', 'a.md'])

    f.put('.settings', 'embeddings:\n  enabled: true\n')
    syncVaultEmbeddings(f.vault)
    await sleep(500)
    const hits = (await vaultSemanticSearch(f.vault, 'gamma', { waitMs: 2000 })) as {
        path: string
        excerpt: string
    }[]
    expect(hits.map(h => h.path)).toEqual(['b.md'])
    expect(hits[0]!.excerpt).toContain('edited')
}, 20_000)

test('a pending debounce timer does not embed after the switch flips off', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)
    f.calls.texts.length = 0

    f.put('a.md', 'beta one changed')
    syncVaultEmbeddings(f.vault, ['a.md'])
    f.put('.settings', 'embeddings:\n  enabled: false\n')
    syncVaultEmbeddings(f.vault)
    await sleep(300)
    expect(f.calls.texts).toEqual([])
})

test('build: a cold one-shot query embeds the vault itself and answers on the first call', async () => {
    const f = fixture()
    // A debounce the process would never live to see, as in a CLI that exits after one query.
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, storeDebounceMs: 60_000 })
    f.put('a.md', '# alpha note\nalpha words')
    f.put('b.md', '# beta note\nbeta words')
    expect(await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })).toMatchObject({ unavailable: 'warming' })
    const r = await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000, build: true })
    expect(isSemanticUnavailable(r)).toBe(false)
    expect((r as { path: string }[])[0]!.path).toBe('b.md')
    expect(await vaultSemanticNeighbours(f.vault, 'a.md', { waitMs: 2000, build: true })).toMatchObject([{ path: 'b.md' }])
})

test('build: a pass that outlasts the budget answers warming with its progress', async () => {
    const f = fixture({ slowEmbed: true })
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, storeDebounceMs: 60_000 })
    f.put('a.md', '# alpha note\nalpha words')
    const r = await vaultSemanticSearch(f.vault, 'alpha', { waitMs: 50, build: true })
    expect(r).toMatchObject({ unavailable: 'warming' })
    expect(isSemanticUnavailable(r) && r.message).toContain('0 of 1 notes embedded')
})

const OLD = new Date('2020-01-01T00:00:00Z')
const OLDER = new Date('2020-06-01T00:00:00Z')
const backdate = (f: { vault: string }, rel: string, d: Date) => utimesSync(join(f.vault, rel), d, d)

test('one edit hashes one note: unchanged notes keep their MemoryNote across a full rescan', async () => {
    const f = fixture()
    f.put('a.md', '# a\nalpha one')
    f.put('b.md', '# b\nbeta two')
    backdate(f, 'a.md', OLD) // out of the racy window, so the parse is stored and its identity is stable
    backdate(f, 'b.md', OLD)
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(200)

    const spy = spyOn(memory, 'noteHash')
    try {
        syncVaultEmbeddings(f.vault) // full rescan
        await sleep(300)
        expect(spy.mock.calls.length).toBe(0)

        f.put('a.md', '# a\nalpha one edited')
        backdate(f, 'a.md', OLDER)
        syncVaultEmbeddings(f.vault, ['a.md'])
        for (let i = 0; i < 50 && spy.mock.calls.length < 1; i++) await sleep(50)
        await sleep(100)
        expect(spy.mock.calls.length).toBe(1)
    } finally {
        spy.mockRestore()
    }
}, 20_000)

test('a spent raw-bytes budget still indexes: the note text is re-read and the excerpt survives', async () => {
    const f = fixture()
    configureParsedNotes({ maxRawBytes: 1 })
    f.put('a.md', '# a note\nalpha words here')
    f.put('b.md', '# b note\nbeta words here')
    backdate(f, 'a.md', OLD)
    backdate(f, 'b.md', OLD)
    const r = (await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))) as {
        path: string
        excerpt: string
    }[]
    expect(r.map(h => h.path).sort()).toEqual(['a.md', 'b.md'])
    expect(r[0]!.path).toBe('b.md')
    expect(r.find(h => h.path === 'a.md')!.excerpt).toContain('alpha words here')
})

/** A valid PDF with one text line per page. */
function makePdf(pages: string[]): string {
    const objs: string[] = []
    const n = pages.length
    objs.push('<< /Type /Catalog /Pages 2 0 R >>')
    objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`)
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    pages.forEach((t, i) => {
        const stream = `BT /F1 12 Tf 20 100 Td (${t}) Tj ET`
        objs.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 6000 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
        )
        objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    })
    let out = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => {
        offs.push(out.length)
        out += `${i + 1} 0 obj\n${o}\nendobj\n`
    })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return out
}

async function sources(f: ReturnType<typeof fixture>, word: string, extra: { deny?: { rel: string; abs: string }[] } = {}) {
    const vec = Float32Array.from(vecOf(QUERY_PREFIX + word))
    for (let i = 0; i < 60; i++) {
        const r = await vaultSourceHits(f.vault, { vec, k: 10, channel: 'chat', ...extra })
        if (r.length > 0) return r
        await sleep(100)
    }
    return []
}

test('a PDF is indexed page by page: a query matching page 4 returns pdf page 4', async () => {
    const f = fixture()
    // Each page is exactly one 588-char chunk body (600 less the 12-char header), so a hit's page is exact.
    const page = (w: string) => `${w} `.repeat(98).trim()
    f.put('x.pdf', makePdf([page('alpha'), page('alpha'), page('alpha'), page('beta')]))
    f.put('n.md', '# n\nalpha note')
    const r = await sources(f, 'beta')
    expect(r[0]).toMatchObject({ kind: 'pdf', id: 'x.pdf', page: 4 })
    expect(r[0]!.excerpt).toContain('beta beta')
    const s = (await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))) as {
        path: string
        kind?: string
        page?: number
    }[]
    expect(s[0]).toMatchObject({ path: 'x.pdf', kind: 'pdf', page: 4 })
    expect(s.find(h => h.path === 'n.md')!.kind).toBeUndefined()
})

test('short PDF pages never share a chunk: a page 2 query returns page 2 with only page 2 text', async () => {
    const f = fixture()
    f.put('x.pdf', makePdf(['alpha one short', 'beta two short']))
    const r = await sources(f, 'beta')
    expect(r.map(h => h.id)).toEqual(['x.pdf'])
    expect(r[0]).toMatchObject({ kind: 'pdf', id: 'x.pdf', page: 2 })
    expect(r[0]!.excerpt).toContain('beta two')
    expect(r[0]!.excerpt).not.toContain('alpha one')
})

test('a PDF companion folds into the PDF entry and is never a hit of its own', async () => {
    const f = fixture()
    f.put('x.pdf', makePdf(['alpha one']))
    f.put('x.pdf.md', '---\ntags: [zeta]\ndescription: gamma paper\n---\nbeta notes')
    const r = await sources(f, 'gamma')
    expect(r.map(h => h.id)).toEqual(['x.pdf'])
    expect(r[0]).toMatchObject({ kind: 'pdf' })
    const doc = f.calls.texts.find(t => t.startsWith('x.pdf\n'))!
    expect(doc).toContain('gamma paper')
    expect(doc).toContain('zeta')
})

test('a PDF with no text layer indexes its companion description only', async () => {
    const f = fixture()
    f.put('scan.pdf', '%PDF-1.4 not really a pdf')
    f.put('scan.pdf.md', '---\ndescription: gamma scan\n---\n')
    const r = await sources(f, 'gamma')
    expect(r).toMatchObject([{ kind: 'pdf', id: 'scan.pdf' }])
    expect(r[0]!.page).toBeUndefined()
    expect(r[0]!.excerpt).toContain('gamma scan')
})

test('an image companion is indexed as the image, its frontmatter description counting', async () => {
    const f = fixture()
    f.put('photo.png', 'png-bytes')
    f.put('photo.png.md', '---\ndescription: a gamma whiteboard sketch\n---\n')
    f.put('bare.png', 'png-bytes')
    f.put('bare.png.md', '')
    f.put('n.md', '# n\nalpha note')
    const r = await sources(f, 'gamma')
    expect(r[0]).toMatchObject({ kind: 'image', id: 'photo.png' })
    expect(r[0]!.excerpt).toContain('gamma whiteboard sketch')
    expect(r.map(h => h.id).sort()).toEqual(['n.md', 'photo.png'])
    const s = (await settled(() => vaultSemanticSearch(f.vault, 'gamma', { waitMs: 2000 }))) as { path: string; kind?: string }[]
    expect(s[0]).toMatchObject({ path: 'photo.png', kind: 'image' })
})

test('notes come back as note sources with a title', async () => {
    const f = fixture()
    f.put('a.md', '# Alpha title\nalpha words')
    const r = await sources(f, 'alpha')
    expect(r[0]).toMatchObject({ kind: 'note', id: 'a.md', title: 'Alpha title' })
    expect(r[0]!.hash.length).toBeGreaterThan(0)
})

test('deny drops a PDF or image before k, dot paths stay out', async () => {
    const f = fixture()
    f.put('private/x.pdf', makePdf(['beta secret']))
    f.put('private/p.png', 'png')
    f.put('private/p.png.md', '---\ndescription: beta secret image\n---\n')
    f.put('.hid/y.pdf', makePdf(['beta hidden']))
    f.put('a.md', 'alpha open')
    await sources(f, 'beta')
    const vec = Float32Array.from(vecOf('beta'))
    const all = await vaultSourceHits(f.vault, { vec, k: 10, channel: 'chat' })
    expect(all.map(h => h.id).sort()).toEqual(['a.md', 'private/p.png', 'private/x.pdf'])
    const deny = [
        { rel: 'private/x.pdf', abs: join(f.vault, 'private/x.pdf') },
        { rel: 'private/p.png', abs: join(f.vault, 'private/p.png') },
    ]
    const r = await vaultSourceHits(f.vault, { vec, k: 1, channel: 'chat', deny })
    expect(r.map(h => h.id)).toEqual(['a.md'])
})

test('the watcher reaches PDFs: an edited PDF re-embeds, a deleted one disappears', async () => {
    const f = fixture()
    f.put('x.pdf', makePdf(['alpha one']))
    expect((await sources(f, 'alpha'))[0]).toMatchObject({ id: 'x.pdf' })
    await sleep(100)
    f.put('x.pdf', makePdf(['gamma edited page']))
    syncVaultEmbeddings(f.vault, ['x.pdf'])
    expect((await sources(f, 'gamma'))[0]).toMatchObject({ id: 'x.pdf' })
    rmSync(join(f.vault, 'x.pdf'))
    syncVaultEmbeddings(f.vault, ['x.pdf'])
    await sleep(400)
    const vec = Float32Array.from(vecOf('gamma'))
    expect(await vaultSourceHits(f.vault, { vec, k: 10, channel: 'chat' })).toEqual([])
}, 20_000)

test('a long PDF is searchable on every page: a query matching page 27 returns it once, on page 27', async () => {
    const f = fixture()
    // 30 pages of about 1000 chars each is far past one entry's 40-chunk cap. Page 27 opens with one
    // word longer than a chunk, so no chunk that starts on page 26 reaches into it.
    const pages = Array.from({ length: 30 }, (_, i) =>
        i === 26 ? 'beta' + 'z'.repeat(700) + ' tail words' : Array.from({ length: 160 }, (_, j) => `p${i + 1}w${j}`).join(' '),
    )
    f.put('x.pdf', makePdf(pages))
    f.put('n.md', '# n\nalpha note')
    const r = await sources(f, 'beta')
    expect(r.filter(h => h.id === 'x.pdf')).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'pdf', id: 'x.pdf', page: 27 })
    const s = (await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))) as {
        path: string
        kind?: string
        page?: number
    }[]
    expect(s.filter(h => h.path === 'x.pdf')).toEqual([expect.objectContaining({ path: 'x.pdf', kind: 'pdf', page: 27 })])
    expect(s.some(h => h.path.includes('#p'))).toBe(false)
    const n = (await vaultSemanticNeighbours(f.vault, 'x.pdf', { k: 5 })) as { path: string }[]
    expect(n.map(h => h.path)).toEqual(['n.md'])
})

test('a PDF companion with tags only still finds a multi-entry PDF, and deleting the PDF removes every entry', async () => {
    const f = fixture()
    const pages = Array.from({ length: 30 }, (_, i) => Array.from({ length: 160 }, (_, j) => `p${i + 1}w${j}`).join(' '))
    f.put('x.pdf', makePdf(pages))
    f.put('x.pdf.md', '---\ndescription: gamma paper\n---\n')
    const r = await sources(f, 'gamma')
    expect(r.map(h => h.id)).toEqual(['x.pdf'])
    rmSync(join(f.vault, 'x.pdf'))
    syncVaultEmbeddings(f.vault, ['x.pdf'])
    await sleep(500)
    const vec = Float32Array.from(vecOf('gamma'))
    expect(await vaultSourceHits(f.vault, { vec, k: 10, channel: 'chat' })).toEqual([])
}, 20_000)
