import { tempDir } from '../helpers'
import { test, expect, describe, afterEach } from 'bun:test'
import { writeNote } from '../../src/files'
import { resolveSource, resolveBaseRows } from '../../src/bases/source'
import { setFileAccess, type FileAccess } from '../../src/fileAccess'

test("resolveSource('notes') returns vault rows filtered by where", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(dir, 'a.md', '---\ntags: [book]\n---\nA')
    await writeNote(dir, 'b.md', '---\ntags: [film]\n---\nB')
    const rows = await resolveSource(
        { kind: 'notes', where: 'file.hasTag("book")' },
        { root: dir },
    )
    expect(rows.map(r => r.file.name)).toEqual(['a'])
})

test("resolveSource('notes') with no where returns all notes", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(dir, 'a.md', 'A')
    await writeNote(dir, 'b.md', 'B')
    const rows = await resolveSource({ kind: 'notes' }, { root: dir })
    expect(rows.length).toBe(2)
})

test("resolveSource('tasks') returns task rows filtered by DSL", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(dir, 't.md', '- [ ] one\n- [x] two')
    const rows = await resolveSource(
        { kind: 'tasks', where: 'not done' },
        { root: dir },
    )
    expect(rows.map(r => r.note.description)).toEqual(['one'])
})

// A translated `sort by` used to be computed and thrown away: source.ts only read
// `.where` off translateTaskDsl's result. Proven here through the real pipeline, not
// just the translated SortSpec (a string/object assertion stays green even when no
// caller ever applies it — that IS the bug this was ported to catch).
test("resolveSource('tasks') applies a translated 'sort by due', not the on-disk scan order", async () => {
    const dir = tempDir('bismuth-src-')
    // Written in an order that is NOT date order, and not alphabetical either — if the
    // fix silently no-ops, this comes back in exactly this write order.
    await writeNote(
        dir,
        't.md',
        [
            '- [ ] z-early [due 2026-01-01]',
            '- [ ] a-late [due 2026-12-01]',
            '- [ ] m-mid [due 2026-06-01]',
        ].join('\n'),
    )
    const rows = await resolveSource(
        { kind: 'tasks', where: 'not done\nsort by due' },
        { root: dir },
    )
    expect(rows.map(r => r.note.description)).toEqual([
        'z-early',
        'm-mid',
        'a-late',
    ])
})

// The trap: the generic bases compare() sorts strings ALPHABETICALLY (high, highest,
// low, lowest, medium, none), not by urgency. A test that only checks "did it sort at
// all" would pass with the wrong comparator wired in.
test("resolveSource('tasks') applies a translated 'sort by priority' in URGENCY order, not alphabetical", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        't.md',
        ['- [ ] a [low]', '- [ ] b [highest]', '- [ ] c [medium]'].join('\n'),
    )
    const rows = await resolveSource(
        { kind: 'tasks', where: 'not done\nsort by priority' },
        { root: dir },
    )
    // Urgency order is highest, high, medium, none, low, lowest. Alphabetical order
    // ("high" < "highest" < "low" < "lowest" < "medium" < "none") would produce a
    // DIFFERENT sequence here, so this fails if the wrong comparator is wired in.
    expect(rows.map(r => r.note.description)).toEqual(['b', 'c', 'a'])
})

// looksLikeTaskDsl anchored on the FIRST LINE ONLY, so a leading paren group made it
// misread real DSL text as a bases expression — passesFilter then threw parsing it, and
// EVERY row silently failed to match. The user's task list would just go blank.
test("resolveSource('tasks') recognises a leading paren group as DSL, not a bases expression", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        't.md',
        [
            '- [ ] one [high]',
            '- [ ] two [low] [due 2000-01-01]',
            '- [ ] three [low] [due 2099-01-01]',
        ].join('\n'),
    )
    const rows = await resolveSource(
        { kind: 'tasks', where: '(priority is high) OR (due before today)' },
        { root: dir },
    )
    expect(rows.map(r => r.note.description).sort()).toEqual(['one', 'two'])
})

// Same misreading for a leading `#` comment line — a query note with a header comment
// above its filter would silently stop filtering at all.
test("resolveSource('tasks') skips a leading '#' comment line when recognising DSL text", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(dir, 't.md', '- [ ] one\n- [x] two')
    const rows = await resolveSource(
        { kind: 'tasks', where: '# hide finished tasks\nnot done' },
        { root: dir },
    )
    expect(rows.map(r => r.note.description)).toEqual(['one'])
})

test("resolveSource('base') reads a base file's own table rows", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'C.md',
        '---\ntype: base\nview: table\n---\n\n| title |\n| --- |\n| Hi |',
    )
    const rows = await resolveSource(
        { kind: 'base', ref: '[[C]]' },
        { root: dir },
    )
    expect(rows[0].note.title).toBe('Hi')
})

test("resolveSource('base') resolves a ref that already carries a .base extension", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(dir, 'Legacy.base', 'views:\n  - type: table\n    name: L')
    // a .base ref must not become Legacy.base.md
    const rows = await resolveSource(
        { kind: 'base', ref: '[[Legacy.base]]' },
        { root: dir },
    )
    expect(Array.isArray(rows)).toBe(true) // resolves the file, not a .md sibling
})

test("resolveSource('base') with a missing ref returns []", async () => {
    const dir = tempDir('bismuth-src-')
    const rows = await resolveSource(
        { kind: 'base', ref: 'Nope' },
        { root: dir },
    )
    expect(rows).toEqual([])
})

test("resolveSource('base') follows the referenced base's OWN notes source (composition)", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'Keep.md',
        '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n',
    )
    await writeNote(dir, 'keep/x.md', '---\ntags: [keep]\n---\nX')
    await writeNote(dir, 'other/z.md', '---\ntags: [other]\n---\nZ')
    const rows = await resolveSource(
        { kind: 'base', ref: '[[Keep]]' },
        { root: dir },
    )
    expect(rows.map(r => r.file.path).sort()).toEqual(['keep/x.md'])
})

test("resolveSource('tasks', from) scopes tasks to the referenced base's notes only", async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'Keep.md',
        '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n',
    )
    await writeNote(
        dir,
        'keep/x.md',
        '---\ntags: [keep]\n---\n- [ ] scoped task',
    )
    await writeNote(dir, 'other/y.md', '- [ ] unscoped task')
    const rows = await resolveSource(
        { kind: 'tasks', from: '[[Keep]]' },
        { root: dir },
    )
    expect(rows.map(r => r.note.description)).toEqual(['scoped task'])
})

test('base composition cycle terminates and returns []', async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'A.md',
        '---\ntype: base\nsource: base\nref: "[[B]]"\n---\n',
    )
    await writeNote(
        dir,
        'B.md',
        '---\ntype: base\nsource: base\nref: "[[A]]"\n---\n',
    )
    const rows = await resolveSource(
        { kind: 'base', ref: '[[A]]' },
        { root: dir },
    )
    expect(rows).toEqual([])
})

test('UNQUOTED from: [[Base]] in a base file still scopes tasks (YAML nested-array regression)', async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'Keep.md',
        '---\ntype: base\nsource: notes\nwhere: file.inFolder("keep")\n---\n',
    )
    await writeNote(dir, 'keep/x.md', '- [ ] scoped')
    await writeNote(dir, 'other/y.md', '- [ ] global')
    // NOTE: from is UNQUOTED here — YAML turns [[Keep]] into [["Keep"]].
    await writeNote(
        dir,
        'DoNow.md',
        '---\ntype: base\nsource: tasks\nfrom: [[Keep]]\n---\n',
    )
    const rows = await resolveBaseRows('DoNow.md', { root: dir })
    expect(rows.map(r => r.note.description)).toEqual(['scoped'])
})

// An own-rows base (no `source:`) returns the parse's table rows directly, so identity
// of the returned array is identity of the cached parse's `rows` — the most direct way
// to observe that the second call skipped parseBaseFile and reused the cache entry.
test('resolveBaseRows reuses the parsed rows by reference when the file is unchanged', async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'Own.md',
        '---\ntype: base\nview: table\n---\n\n| title |\n| --- |\n| Hi |',
    )
    const first = await resolveBaseRows('Own.md', { root: dir })
    const second = await resolveBaseRows('Own.md', { root: dir })
    expect(second).toBe(first)
})

test('resolveBaseRows re-parses after the base file is rewritten, with no sleep between writes', async () => {
    const dir = tempDir('bismuth-src-')
    await writeNote(
        dir,
        'Own.md',
        '---\ntype: base\nview: table\n---\n\n| title |\n| --- |\n| Hi |',
    )
    const first = await resolveBaseRows('Own.md', { root: dir })
    expect(first[0].note.title).toBe('Hi')

    // Rewrite immediately — no sleep, so this can land within the same mtime tick as the
    // first read. A mtime-keyed cache would incorrectly serve the stale 'Hi' row here.
    await writeNote(
        dir,
        'Own.md',
        '---\ntype: base\nview: table\n---\n\n| title |\n| --- |\n| Bye |',
    )
    const second = await resolveBaseRows('Own.md', { root: dir })
    expect(second).not.toBe(first)
    expect(second[0].note.title).toBe('Bye')
})

// Scoped in its own describe so the injected stub resets after this test and never
// leaks into the on-disk tests above/below, which all go through the real files.ts
// reader via tempDir/writeNote.
describe('resolveBaseRows realPath rooting (FileAccess seam)', () => {
    afterEach(() => setFileAccess(undefined as unknown as FileAccess))

    test('resolveBaseRows canonicalizes an ABSOLUTE vault path, so its keys are vault-scoped', async () => {
        const asked: string[] = []
        const stub = (): FileAccess => ({
            listMarkdown: async () => ['A.md'],
            listTree: async () => [],
            readNote: async () => '---\ntype: base\n---\n',
            writeNote: async () => {},
            statNote: async () => null,
            realPath: async p => {
                asked.push(p)
                return p
            },
        })
        setFileAccess(stub())
        await resolveSource({ kind: 'base', ref: '[[A]]' }, { root: '/vault-one' })
        await resolveSource({ kind: 'base', ref: '[[A]]' }, { root: '/vault-two' })
        // Absolute and rooted, so the two vaults' identically-named base files never share a key.
        expect(asked).toEqual(['/vault-one/A.md', '/vault-two/A.md'])
    })
})
