import { tempDir } from '../helpers'
import { test, expect, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildFileRows, buildVaultRows } from '../../src/basesData'
import { resolveSource } from '../../src/bases/source'
import { normalizeSource } from '../../src/bases/sourceSpec'
import { passesFilter } from '../../src/bases/filters'
import { toContext } from '../../src/bases/query'
import { writeNote } from '../../src/files'
import { configureParsedNotes } from '../../src/parsedNotes'

afterEach(() => configureParsedNotes())

function put(vault: string, rel: string, bytes = 'x') {
    mkdirSync(dirname(join(vault, rel)), { recursive: true })
    writeFileSync(join(vault, rel), bytes)
}

async function seed() {
    const vault = tempDir('bismuth-files-')
    await writeNote(vault, 'post.md', '---\ntitle: Post\n---\n![[photo.png]] and [[paper.pdf]]')
    await writeNote(vault, 'lonely.md', 'no links')
    put(vault, 'img/photo.png', 'png-bytes')
    put(vault, 'img/unused.jpg')
    put(vault, 'paper.pdf', '%PDF-1.4')
    await writeNote(vault, 'paper.pdf.md', '---\ntags: [reading]\nauthor: Ada\n---\nsee [[lonely]]')
    put(vault, 'paper.pdf.draw', '{}')
    put(vault, 'sketch.draw', '{}')
    put(vault, 'sketch.draw.png')
    put(vault, 'song.mp3')
    put(vault, 'LICENSE')
    put(vault, 'Attachments.base.jsonl', '{"view":"table"}\n')
    put(vault, '.hidden/secret.png')
    return vault
}

test('a files source lists every file the sidebar lists, one row each; other kinds are left out', async () => {
    const vault = await seed()
    const rows = await resolveSource({ kind: 'files' }, { root: vault })
    expect(rows.map(r => r.file.path).sort()).toEqual([
        'Attachments.base.jsonl',
        'img/photo.png',
        'img/unused.jpg',
        'lonely.md',
        'paper.pdf',
        'post.md',
        'sketch.draw',
    ])
})

test('an attachment row carries its own ext, size and a name with its extension', async () => {
    const vault = await seed()
    const rows = await buildFileRows(vault, await buildVaultRows(vault))
    const photo = rows.find(r => r.file.path === 'img/photo.png')!
    expect(photo.file.ext).toBe('png')
    expect(photo.file.name).toBe('photo.png')
    expect(photo.file.basename).toBe('photo')
    expect(photo.file.folder).toBe('img')
    expect(photo.file.size).toBe('png-bytes'.length)
    expect(photo.file.mtime).toBeGreaterThan(0)
    expect(photo.note).toEqual({})
    const post = rows.find(r => r.file.path === 'post.md')!
    expect(post.file.name).toBe('post')
    expect(post.note.title).toBe('Post')
    const base = rows.find(r => r.file.path === 'Attachments.base.jsonl')!
    expect(base.file.ext).toBe('base')
    expect(base.file.basename).toBe('Attachments')
})

test("a PDF's row reads its companion note's properties, tags and links", async () => {
    const vault = await seed()
    const rows = await buildFileRows(vault, await buildVaultRows(vault))
    const pdf = rows.find(r => r.file.path === 'paper.pdf')!
    expect(pdf.note.author).toBe('Ada')
    expect(pdf.file.tags).toEqual(['reading'])
    expect(pdf.file.links).toEqual(['lonely'])
    // the companion's link counts as the PDF's backlink to `lonely`
    const lonely = rows.find(r => r.file.path === 'lonely.md')!
    expect(lonely.file.backlinks).toEqual(['paper.pdf'])
})

test('backlinks reach attachments through embeds and links', async () => {
    const vault = await seed()
    const rows = await buildFileRows(vault, await buildVaultRows(vault))
    const by = (p: string) => rows.find(r => r.file.path === p)!
    expect(by('img/photo.png').file.backlinks).toEqual(['post'])
    expect(by('paper.pdf').file.backlinks).toEqual(['post'])
    expect(by('img/unused.jpg').file.backlinks).toEqual([])
})

test('the notes feed is not mutated by a files build', async () => {
    const vault = await seed()
    const notes = await buildVaultRows(vault)
    const before = JSON.stringify(notes)
    await buildFileRows(vault, notes)
    expect(JSON.stringify(notes)).toBe(before)
})

test("an orphaned companion (its binary gone) is an ordinary note row", async () => {
    const vault = tempDir('bismuth-files-orphan-')
    await writeNote(vault, 'gone.png.md', '---\ntags: [x]\n---\n')
    const rows = await resolveSource({ kind: 'files' }, { root: vault })
    expect(rows.map(r => r.file.path)).toEqual(['gone.png.md'])
})

test("kepano's attachment filters select the images and the unused ones", async () => {
    const vault = await seed()
    const rows = await resolveSource({ kind: 'files' }, { root: vault })
    const pass = (expr: string) =>
        rows.filter(r => passesFilter(expr, toContext(r))).map(r => r.file.path).sort()
    const images = '!file.ext.containsAny("base", "md", "pdf", "canvas", "draw")'
    expect(pass(images)).toEqual(['img/photo.png', 'img/unused.jpg'])
    expect(pass(`${images} && file.backlinks.isEmpty()`)).toEqual(['img/unused.jpg'])
})

test('a files source takes a where filter, and `source: files` parses', async () => {
    const vault = await seed()
    const rows = await resolveSource(
        { kind: 'files', where: 'file.ext == "pdf"' },
        { root: vault },
    )
    expect(rows.map(r => r.file.path)).toEqual(['paper.pdf'])
    expect(normalizeSource('files', {})).toEqual({ kind: 'files' })
    expect(normalizeSource('files where file.ext == "png"', {})).toEqual({
        kind: 'files',
        where: 'file.ext == "png"',
    })
    expect(normalizeSource({ kind: 'files' }, {})).toEqual({ kind: 'files' })
})
