import { test, expect } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { resolveTaskFilePath, appendTaskLine } from '../src/taskCreate'
import { readNote, writeNote } from '../src/files'

// --- resolveTaskFilePath (pure) --------------------------------------------------

test('resolves a bare basename living in a subfolder', () => {
    const ids = ['tasks/general/General Tasks', 'other/Note']
    expect(resolveTaskFilePath('General Tasks', ids)).toBe(
        'tasks/general/General Tasks.md',
    )
})

test('resolves a [[bracketed]] ref', () => {
    const ids = ['tasks/general/General Tasks']
    expect(resolveTaskFilePath('[[General Tasks]]', ids)).toBe(
        'tasks/general/General Tasks.md',
    )
})

test('resolves a path-qualified ref via the exact-match branch', () => {
    const ids = ['tasks/general/General Tasks', 'General Tasks']
    // A path-qualified ref names an exact id — it must win over pickByBase, which
    // would otherwise prefer the shallower "General Tasks" id.
    expect(
        resolveTaskFilePath('tasks/general/General Tasks', ids),
    ).toBe('tasks/general/General Tasks.md')
})

test('resolves a ref already ending .md', () => {
    const ids = ['tasks/general/General Tasks']
    expect(
        resolveTaskFilePath('tasks/general/General Tasks.md', ids),
    ).toBe('tasks/general/General Tasks.md')
})

test('two notes sharing a basename resolve to the shallower one (preferId)', () => {
    const ids = ['tasks/general/General Tasks', 'a/b/c/General Tasks']
    expect(resolveTaskFilePath('General Tasks', ids)).toBe(
        'tasks/general/General Tasks.md',
    )
})

test('a ref matching nothing becomes a new root note', () => {
    const ids = ['tasks/general/General Tasks']
    expect(resolveTaskFilePath('[[Nonexistent Note]]', ids)).toBe(
        'Nonexistent Note.md',
    )
})

// --- appendTaskLine (server-side, real filesystem) --------------------------------

test('appends into the real vault-nested note, not a new root file', async () => {
    const vault = tempDir('bismuth-taskcreate-')
    mkdirSync(join(vault, 'tasks/general'), { recursive: true })
    await writeNote(vault, 'tasks/general/General Tasks.md', '# General Tasks\n')

    const path = await appendTaskLine(
        vault,
        '[[General Tasks]]',
        '[scheduled 2026-09-16]',
    )

    expect(path).toBe('tasks/general/General Tasks.md')
    const content = await readNote(vault, path)
    expect(content).toBe(
        '# General Tasks\n- [ ] [scheduled 2026-09-16]\n',
    )
})

test('does not insert a blank line when the file already ends in a newline', async () => {
    const vault = tempDir('bismuth-taskcreate-')
    await writeNote(vault, 'Inbox.md', 'x\n')

    await appendTaskLine(vault, '[[Inbox]]', 'buy milk')

    expect(await readNote(vault, 'Inbox.md')).toBe('x\n- [ ] buy milk\n')
})

test('does not join onto a file that ends mid-line', async () => {
    const vault = tempDir('bismuth-taskcreate-')
    await writeNote(vault, 'Inbox.md', 'x')

    await appendTaskLine(vault, '[[Inbox]]', 'buy milk')

    expect(await readNote(vault, 'Inbox.md')).toBe('x\n- [ ] buy milk\n')
})

test('creates the note when the ref resolves to nothing', async () => {
    const vault = tempDir('bismuth-taskcreate-')

    const path = await appendTaskLine(vault, '[[Brand New]]', 'first task')

    expect(path).toBe('Brand New.md')
    expect(await readNote(vault, 'Brand New.md')).toBe('- [ ] first task\n')
})
