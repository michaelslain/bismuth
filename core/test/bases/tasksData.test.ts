import { tempDir } from '../helpers'
import { test, expect } from 'bun:test'
import {
    taskToRow,
    buildTaskRows,
    patchTaskRows,
} from '../../src/bases/tasksData'
import { createAsyncCache } from '../../src/asyncCache'
import { writeNote } from '../../src/files'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '../../src/tasks'

function mkTask(over: Partial<Task>): Task {
    return {
        path: 'a.md',
        line: 0,
        raw: '- [ ] x',
        indent: '',
        status: 'todo',
        statusChar: ' ',
        description: 'x',
        priority: 'none',
        tags: [],
        ...over,
    } as Task
}

test('taskToRow maps task fields into Row.note, one row per checkbox', () => {
    const row = taskToRow(
        mkTask({
            path: 'journal/2026-05-30.md',
            line: 4,
            description: 'call mom',
            due: '2026-06-01',
        }),
    )
    expect(row.note.description).toBe('call mom')
    expect(row.note.status).toBe('todo')
    expect(row.note.due).toBe('2026-06-01')
    expect(row.file.path).toBe('journal/2026-05-30.md')
    expect(row.file.name).toBe('2026-05-30')
    expect(row.file.folder).toBe('journal')
    expect(row.note.line).toBe(4) // line preserved for write-back
})

// The incremental patch must yield a task-rows feed content-identical to a full rebuild
// (order aside — see patchTaskRows's header comment on why task rows don't need to match
// rebuild order), so a base render after an edit is fast (patch a few notes) yet never
// shows stale/wrong task rows.
async function seededCache(vault: string) {
    const cache = createAsyncCache(() => buildTaskRows(vault))
    await cache.get()
    return cache
}
const norm = (rows: any[]) =>
    JSON.stringify(
        [...rows].sort((a, b) =>
            `${a.file.path} ${a.note.description}`.localeCompare(
                `${b.file.path} ${b.note.description}`,
            ),
        ),
    )

test('patchTaskRows: an edited notes tasks are replaced, others stay ===-identical', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] alpha\n- [ ] beta\n')
    await writeNote(vault, 'b.md', '- [ ] gamma\n')
    const cache = await seededCache(vault)
    const bRowBefore = cache.peek()!.find(r => r.file.path === 'b.md')!

    await writeNote(vault, 'a.md', '- [ ] alpha edited\n')
    await patchTaskRows(vault, ['a.md'], cache)

    const after = cache.peek()!
    expect(norm(after)).toBe(norm(await buildTaskRows(vault)))
    const aRows = after.filter(r => r.file.path === 'a.md')
    expect(aRows.length).toBe(1)
    expect(aRows[0].note.description).toBe('alpha edited')
    // b.md was never in the changed-paths set — its row object must be untouched, not
    // merely equal, proving the patch didn't rebuild the whole feed.
    expect(after.find(r => r.file.path === 'b.md')).toBe(bRowBefore)
})

test('patchTaskRows: a note losing its only task loses its row', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] only task\n')
    await writeNote(vault, 'b.md', '- [ ] keep\n')
    const cache = await seededCache(vault)

    await writeNote(vault, 'a.md', 'no tasks here anymore\n')
    await patchTaskRows(vault, ['a.md'], cache)

    const after = cache.peek()!
    expect(after.some(r => r.file.path === 'a.md')).toBe(false)
    expect(after.some(r => r.file.path === 'b.md')).toBe(true)
    expect(norm(after)).toBe(norm(await buildTaskRows(vault)))
})

test('patchTaskRows: a brand-new notes tasks appear', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] existing\n')
    const cache = await seededCache(vault)

    await writeNote(vault, 'fresh.md', '- [ ] brand new task\n')
    await patchTaskRows(vault, ['fresh.md'], cache)

    const after = cache.peek()!
    const fresh = after.find(r => r.file.path === 'fresh.md')
    expect(fresh).toBeDefined()
    expect(fresh!.note.description).toBe('brand new task')
    expect(norm(after)).toBe(norm(await buildTaskRows(vault)))
})

test('patchTaskRows: a deleted notes rows are gone', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] keep\n')
    await writeNote(vault, 'gone.md', '- [ ] will vanish\n')
    const cache = await seededCache(vault)

    rmSync(join(vault, 'gone.md'))
    await patchTaskRows(vault, ['gone.md'], cache)

    const after = cache.peek()!
    expect(after.some(r => r.file.path === 'gone.md')).toBe(false)
    expect(norm(after)).toBe(norm(await buildTaskRows(vault)))
})

test('patchTaskRows: empty cache and non-md paths are safe no-ops', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] keep\n')
    const cache = await seededCache(vault)

    // Non-.md changes never touch the tasks feed → same array reference, untouched.
    const before = cache.peek()
    await patchTaskRows(vault, ['a.png', 'assets/'], cache)
    expect(cache.peek()).toBe(before)

    // Patching an empty cache must not throw and leaves it empty (next read rebuilds).
    cache.invalidate()
    await patchTaskRows(vault, ['a.md'], cache)
    expect(cache.peek()).toBeNull()
})

test('patchTaskRows: a dot-path note never enters the feed', async () => {
    const vault = tempDir('bismuth-task-patch-')
    await writeNote(vault, 'a.md', '- [ ] real\n')
    const cache = await seededCache(vault)

    mkdirSync(join(vault, '.daemon/memory'), { recursive: true })
    writeFileSync(join(vault, '.daemon/memory/m.md'), '- [ ] phantom\n')
    await patchTaskRows(vault, ['.daemon/memory/m.md'], cache)

    expect(norm(cache.peek()!)).toBe(norm(await buildTaskRows(vault)))
})
