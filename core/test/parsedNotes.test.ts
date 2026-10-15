import { test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    getFileAccess,
    setFileAccess,
    type FileAccess,
} from '../src/fileAccess'
import { extractFingerprint } from '../src/changeClassifier'
import {
    configureParsedNotes,
    forgetParsedNotes,
    getParsedNote,
    getParsedNotes,
    parsedNoteStats,
} from '../src/parsedNotes'
import { tempDir } from './helpers'

beforeEach(() => configureParsedNotes())
afterEach(() => {
    configureParsedNotes()
    setFileAccess(undefined as unknown as FileAccess)
})

const OLD = new Date('2020-01-01T00:00:00Z')

/** A vault dir whose notes are backdated past the racy window, so they are storable. */
function vaultWith(notes: Record<string, string>): string {
    const root = tempDir('parsed-notes-')
    for (const [rel, text] of Object.entries(notes)) write(root, rel, text)
    return root
}

function write(root: string, rel: string, text: string, when: Date = OLD) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
    utimesSync(full, when, when)
}

test('a second read of an unchanged note is a hit and returns the same object', async () => {
    const root = vaultWith({ 'a.md': '---\nicon: x\n---\n[[b]] #t body' })
    // Count this test's own reads instead of the module-wide hit/miss counters, which any
    // background read left over from another test file in the same process can also bump.
    const real = await getFileAccess()
    let reads = 0
    setFileAccess({
        ...real,
        readNote: (r, rel) => {
            if (r === root) reads++
            return real.readNote(r, rel)
        },
    })
    const first = await getParsedNote(root, 'a.md')
    const second = await getParsedNote(root, 'a.md')
    expect(second).toBe(first!)
    expect(reads).toBe(1)
    expect(first!.links).toEqual(['b'])
    expect(first!.tags).toEqual(['t'])
    expect(first!.data).toEqual({ icon: 'x' })
    expect(first!.body).toBe('[[b]] #t body')
})

test('a changed mtime or size misses and re-parses', async () => {
    const root = vaultWith({ 'a.md': 'one [[x]]' })
    const first = await getParsedNote(root, 'a.md')
    write(root, 'a.md', 'one [[x]]', new Date('2021-01-01T00:00:00Z')) // mtime only
    const second = await getParsedNote(root, 'a.md')
    expect(second).not.toBe(first!)
    write(root, 'a.md', 'one [[x]] [[y]]', new Date('2021-01-01T00:00:00Z')) // size only
    const third = await getParsedNote(root, 'a.md')
    expect(third!.links).toEqual(['x', 'y'])
    expect(parsedNoteStats().misses).toBe(3)
})

test('a note modified inside the racy window is returned but not stored', async () => {
    const root = vaultWith({})
    write(root, 'fresh.md', '[[a]]', new Date())
    const first = await getParsedNote(root, 'fresh.md')
    const second = await getParsedNote(root, 'fresh.md')
    expect(first!.links).toEqual(['a'])
    expect(second).not.toBe(first!)
    expect(parsedNoteStats()).toMatchObject({ entries: 0, hits: 0, misses: 2 })
})

test('the racy window follows the configured clock', async () => {
    const root = vaultWith({ 'a.md': 'x' })
    configureParsedNotes({ now: () => OLD.getTime() + 500 })
    await getParsedNote(root, 'a.md')
    expect(parsedNoteStats().entries).toBe(0)
    configureParsedNotes({ now: () => OLD.getTime() + 5000, racyMs: 1000 })
    await getParsedNote(root, 'a.md')
    expect(parsedNoteStats().entries).toBe(1)
})

test('forget drops named notes; with no list it drops every note under the root', async () => {
    const root = vaultWith({ 'a.md': 'a', 'b.md': 'b' })
    const other = vaultWith({ 'a.md': 'other' })
    await getParsedNotes(root, ['a.md', 'b.md'])
    await getParsedNote(other, 'a.md')
    forgetParsedNotes(root, ['a.md'])
    expect(parsedNoteStats().entries).toBe(2)
    forgetParsedNotes(root)
    expect(parsedNoteStats().entries).toBe(1)
})

test('forgetting a folder drops every note beneath it and leaves a sibling folder alone', async () => {
    const root = vaultWith({
        'folder/a.md': 'a',
        'folder/deep/b.md': 'b',
        'folder2/x.md': 'x',
        'top.md': 't',
    })
    await getParsedNotes(root, [
        'folder/a.md',
        'folder/deep/b.md',
        'folder2/x.md',
        'top.md',
    ])
    expect(parsedNoteStats().entries).toBe(4)
    forgetParsedNotes(root, ['folder'])
    expect(parsedNoteStats().entries).toBe(2)
    const hitsBefore = parsedNoteStats().hits
    await getParsedNote(root, 'folder2/x.md')
    expect(parsedNoteStats().hits).toBe(hitsBefore + 1) // the sibling survived
})

test('a vault-relative forget of a memory-dir note drops the memory graph entry', async () => {
    const vault = vaultWith({ '.daemon/memory/x.md': '[[y]]' })
    const memoryRoot = join(vault, '.daemon', 'memory')
    await getParsedNote(memoryRoot, 'x.md')
    expect(parsedNoteStats().entries).toBe(1)
    forgetParsedNotes(vault + '/', ['.daemon/memory/x.md'])
    expect(parsedNoteStats().entries).toBe(0)
})

test('a read in flight when its note is forgotten is not stored', async () => {
    const root = vaultWith({ 'a.md': 'old text' })
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    let entered!: () => void
    const parked = new Promise<void>(r => (entered = r))
    const real = await realAccess()
    setFileAccess({
        ...real,
        readNote: async (r, rel) => {
            const text = await real.readNote(r, rel)
            entered()
            await gate
            return text
        },
    })
    const pending = getParsedNote(root, 'a.md')
    await parked // the read is parked on the gate
    forgetParsedNotes(root, ['a.md'])
    release()
    const got = await pending
    expect(got!.raw).toBe('old text') // the caller still gets what it read
    expect(parsedNoteStats().entries).toBe(0) // but the stale parse is not kept
})

test('forgetting a whole root also voids a read in flight under it', async () => {
    const root = vaultWith({ 'a.md': 'x' })
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    let entered!: () => void
    const parked = new Promise<void>(r => (entered = r))
    const real = await realAccess()
    setFileAccess({
        ...real,
        readNote: async (r, rel) => {
            const text = await real.readNote(r, rel)
            entered()
            await gate
            return text
        },
    })
    const pending = getParsedNote(root, 'a.md')
    await parked
    forgetParsedNotes(root)
    release()
    await pending
    expect(parsedNoteStats().entries).toBe(0)
})

test('concurrent reads of one note share one parse', async () => {
    const root = vaultWith({ 'a.md': 'x' })
    const real = await realAccess()
    let reads = 0
    setFileAccess({
        ...real,
        readNote: async (r, rel) => {
            reads++
            return real.readNote(r, rel)
        },
    })
    const [a, b, c] = await Promise.all([
        getParsedNote(root, 'a.md'),
        getParsedNote(root, 'a.md'),
        getParsedNote(root, 'a.md'),
    ])
    expect(reads).toBe(1)
    expect(b).toBe(a!)
    expect(c).toBe(a!)
})

test('a null stat and a zero mtime read without storing', async () => {
    const real = await realAccess()
    const files: Record<string, string> = { 'a.md': 'body [[b]]' }
    const access = (stat: FileAccess['statNote']): FileAccess => ({
        ...real,
        statNote: stat,
        readNote: async (_r, rel) => {
            if (!(rel in files)) throw new Error('ENOENT')
            return files[rel]!
        },
    })
    setFileAccess(access(async () => null))
    const viaNull = await getParsedNote('/mem', 'a.md')
    expect(viaNull!.links).toEqual(['b'])
    expect(viaNull!.stat).toEqual({
        size: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
    })
    setFileAccess(
        access(async () => ({
            size: 10,
            mtimeMs: 0,
            ctimeMs: 0,
            birthtimeMs: 0,
        })),
    )
    await getParsedNote('/mem', 'a.md')
    expect(parsedNoteStats().entries).toBe(0)
})

test('a FileAccess with only list/read/stat serves the cache (the mobile seam)', async () => {
    const files: Record<string, string> = { 'a.md': '[[b]]', 'b.md': 'leaf' }
    let reads = 0
    setFileAccess({
        listBases: async () => [],
        listMarkdown: async () => Object.keys(files),
        listTree: async () => [],
        readNote: async (_r, rel) => {
            reads++
            return files[rel]!
        },
        writeNote: async () => {},
        readBinary: async () => new Uint8Array(),
        writeBinary: async () => {},
        statNote: async (_r, rel) => ({
            size: files[rel]!.length,
            mtimeMs: OLD.getTime(),
            ctimeMs: OLD.getTime(),
            birthtimeMs: OLD.getTime(),
        }),
        listDir: async () => [],
        realPath: async p => p,
    })
    await getParsedNotes('/vault', ['a.md', 'b.md'])
    await getParsedNotes('/vault', ['a.md', 'b.md'])
    expect(reads).toBe(2)
    expect(parsedNoteStats().hits).toBe(2)
})

test('past the raw budget a note keeps its parsed fields but drops raw and body', async () => {
    const root = vaultWith({ 'a.md': 'aaaa [[x]]', 'b.md': 'bbbb [[y]]' })
    configureParsedNotes({ maxRawBytes: 12 })
    const got = await getParsedNotes(root, ['a.md', 'b.md'])
    // Both reads are in flight together, so which note is stored first is up to the scheduler:
    // assert the budget outcome, not the order. Exactly one keeps its text; the other keeps only
    // its parsed fields.
    expect(got.map(n => n.rel)).toEqual(['a.md', 'b.md'])
    const kept = got.filter(n => n.raw !== null)
    const dropped = got.filter(n => n.raw === null)
    expect(kept).toHaveLength(1)
    expect(dropped).toHaveLength(1)
    expect(kept[0]!.raw).toBe(
        kept[0]!.rel === 'a.md' ? 'aaaa [[x]]' : 'bbbb [[y]]',
    )
    expect(dropped[0]!.body).toBeNull()
    expect(dropped[0]!.links).toEqual([dropped[0]!.rel === 'a.md' ? 'x' : 'y'])
    expect(parsedNoteStats().rawBytes).toBe('aaaa [[x]]'.length)
    forgetParsedNotes(root)
    expect(parsedNoteStats().rawBytes).toBe(0)
})

test('unreadable notes are skipped, in order, and reported', async () => {
    const root = vaultWith({ 'a.md': 'a', 'c.md': 'c' })
    const errors: string[] = []
    const got = await getParsedNotes(root, ['a.md', 'gone.md', 'c.md'], rel =>
        errors.push(rel),
    )
    expect(got.map(n => n.rel)).toEqual(['a.md', 'c.md'])
    expect(errors).toEqual(['gone.md'])
    expect(await getParsedNote(root, 'gone.md')).toBeNull()
})

test('a note deleted after it was cached reads as gone, not as the old text', async () => {
    const root = vaultWith({ 'a.md': 'a' })
    await getParsedNote(root, 'a.md')
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'a.md'))
    expect(await getParsedNote(root, 'a.md')).toBeNull()
    expect(parsedNoteStats().entries).toBe(0)
})

test('fingerprints match extractFingerprint over fixture notes, bases included', async () => {
    const fixtures: Record<string, string> = {
        'plain.md': 'no links at all',
        'full.md':
            '---\nicon: 📕\nvisibility: hidden\ntags: [a, b]\n---\nSee [[Other]] [[Other]] #inline',
        'dup.md': '[[b]] [[a]] #z #y',
        'empty.md': '',
        'base.base.jsonl':
            '{"view":"table","icon":"B","visibility":"chat-only"}\n{"a":1}\n',
    }
    const root = vaultWith(fixtures)
    for (const [rel, text] of Object.entries(fixtures)) {
        const note = await getParsedNote(root, rel)
        expect(note!.fingerprint).toEqual(extractFingerprint(text))
    }
})

test('data, links and tags are frozen', async () => {
    const root = vaultWith({ 'a.md': '---\nk: v\n---\n[[x]] #t' })
    const note = await getParsedNote(root, 'a.md')
    expect(Object.isFrozen(note!.data)).toBe(true)
    expect(Object.isFrozen(note!.links)).toBe(true)
    expect(Object.isFrozen(note!.tags)).toBe(true)
})

async function realAccess(): Promise<FileAccess> {
    setFileAccess(undefined as unknown as FileAccess)
    const { getFileAccess } = await import('../src/fileAccess')
    return getFileAccess()
}

test('a markdown note that starts with a brace still yields links and tags', async () => {
    const root = vaultWith({ 'a.md': '{{x}} [[B]] #t' })
    const note = await getParsedNote(root, 'a.md')
    expect(note!.links).toEqual(['B'])
    expect(note!.tags).toEqual(['t'])
})
