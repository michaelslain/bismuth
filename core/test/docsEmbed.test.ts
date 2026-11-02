import { test, expect, afterAll, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import { configureDocsEmbed, docSections, docSlug, docsSourceHits, resolveDocsRoot } from '../src/docsEmbed'
import { readDoc } from '../../mcp/src/docs'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => {
    configureDocsEmbed()
    delete process.env.BISMUTH_DOCS_DIR
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fake model: bag of words hashed into 32 dims, unit length.
const embedText = (t: string): Float32Array => {
    const v = new Float32Array(32)
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        let h = 0
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
        v[h % 32]! += 1
    }
    const n = Math.hypot(...v) || 1
    return v.map(x => x / n)
}

function fixture() {
    const root = tempDir('docs-')
    const calls = { texts: [] as string[] }
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(root, rel)), { recursive: true })
        writeFileSync(join(root, rel), body)
    }
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.texts.push(...texts)
            return texts.map(embedText)
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    configureDocsEmbed({ channel, vectorsDir: tempDir('dv-'), docsRoot: root, storeDebounceMs: 10 })
    return { root, put, calls }
}

const query = (text: string, k = 5) => ({ vec: embedText(text), k, channel: 'chat' as const })

async function settled(text: string) {
    for (let i = 0; i < 60; i++) {
        const r = await docsSourceHits(query(text))
        if (r.length) return r
        await sleep(50)
    }
    throw new Error('never settled')
}

test('resolveDocsRoot: env, then the repo docs, null when none', () => {
    const dir = tempDir('envdocs-')
    process.env.BISMUTH_DOCS_DIR = dir
    expect(resolveDocsRoot()).toBe(dir)
    process.env.BISMUTH_DOCS_DIR = join(dir, 'missing')
    const r = resolveDocsRoot()
    expect(r === null || r.endsWith('docs')).toBe(true)
})

test('resolveDocsRoot: bismuthHome docs wins over the repo docs, which take over once it is gone', () => {
    const home = tempDir('home-')
    const prior = process.env.BISMUTH_HOME
    process.env.BISMUTH_HOME = home
    try {
        delete process.env.BISMUTH_DOCS_DIR
        mkdirSync(join(home, 'docs'))
        expect(resolveDocsRoot()).toBe(join(home, 'docs'))
        rmSync(join(home, 'docs'), { recursive: true })
        expect(resolveDocsRoot()).toBe(join(import.meta.dir, '..', '..', 'docs'))
    } finally {
        if (prior === undefined) delete process.env.BISMUTH_HOME
        else process.env.BISMUTH_HOME = prior
    }
})

test('one entry per ## section, id and title shaped for bismuth_docs_read', () => {
    const notes = docSections('a/b.md', '# Page\n\nintro\n\n## One\nx\n### Deep\ny\n\n## Two\nz\n', 'b')
    expect(notes.map(n => n.name)).toEqual(['a/b.md', 'a/b.md#one', 'a/b.md#two'])
    expect(notes[1]!.frontmatter.description).toBe('Page // One')
    expect(notes[1]!.content).toContain('### Deep')
    expect(docSections('c.md', 'just text', 'c').map(n => n.name)).toEqual(['c.md'])
})

test('anchors read back through mcp readDoc, duplicates and odd headings included', () => {
    const f = fixture()
    const text = '# T\n\n## Config keys\nalpha\n\n### Sub\nq\n\n## Sub\nbeta\n\n## `calendar` view: x!\ngamma\n\n## Sub\ndelta\n'
    f.put('p.md', text)
    const notes = docSections('p.md', text, 'p')
    expect(docSlug('`calendar` view: x!')).toBe('calendar-view-x')
    for (const n of notes.filter(n => n.name.includes('#'))) {
        const got = readDoc(f.root, n.name)
        expect(got).toContain(n.content.split('\n')[0]!)
    }
    expect(notes.map(n => n.name)).toEqual(['p.md#config-keys', 'p.md#sub-1', 'p.md#calendar-view-x', 'p.md#sub-2'])
})

test('a calendar base query ranks the calendar authoring section first', async () => {
    const f = fixture()
    f.put('bases/authoring/calendar.md', '# calendar\n\n## Working example\nhow do I write a calendar view base with date keys\n\n## Failure modes\nnothing\n')
    f.put('bases/authoring/kanban.md', '# kanban\n\n## Working example\ncolumns and cards grouped by status\n')
    f.put('vault/visibility.md', '# visibility\n\n## Deny list\nhidden paths and chat only files\n')
    const hits = await settled('how do I write a calendar view base')
    expect(hits[0]!.kind).toBe('docs')
    expect(hits[0]!.id).toBe('bases/authoring/calendar.md#working-example')
    expect(hits[0]!.title).toBe('calendar // Working example')
    expect(hits[0]!.hash).toBeTruthy()
    expect(hits[0]!.excerpt.length).toBeLessThanOrEqual(300)
})

test('only changed pages re-embed', async () => {
    const f = fixture()
    f.put('a.md', '# a\n\n## One\nalpha text\n')
    f.put('b.md', '# b\n\n## Two\nbeta text\n')
    await settled('alpha')
    const before = f.calls.texts.length
    await docsSourceHits(query('alpha'))
    await sleep(100)
    expect(f.calls.texts.length).toBe(before)
    f.put('b.md', '# b\n\n## Two\nbeta text changed entirely\n')
    for (let i = 0; i < 40 && f.calls.texts.length === before; i++) {
        await docsSourceHits(query('alpha'))
        await sleep(50)
    }
    const added = f.calls.texts.slice(before)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every(t => t.includes('b.md'))).toBe(true)
})

test('no root or no embedder yields nothing', async () => {
    const f = fixture()
    configureDocsEmbed({ docsRoot: null })
    expect(await docsSourceHits(query('x'))).toEqual([])
    const channel = createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' })
    configureDocsEmbed({ channel, docsRoot: f.root })
    expect(await docsSourceHits(query('x'))).toEqual([])
})
