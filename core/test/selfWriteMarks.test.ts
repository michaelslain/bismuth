// core/test/selfWriteMarks.test.ts
//
// Pure unit tests for the self-write mark/rearm/consume/unmark logic, extracted out of
// server.ts so its expiry semantics are testable without a real filesystem watcher or debounce
// timer. See core/src/selfWriteMarks.ts for the design.
import { test, expect } from 'bun:test'
import { createSelfWriteMarks } from '../src/selfWriteMarks'

/** A fake clock + a fake disk: `disk[path]` is the path's stamp, bumped by `write()`. */
function setup() {
    const env = { t: 0 }
    const disk = new Map<string, string>()
    let n = 0
    const write = (p: string) => disk.set(p, `v${++n}`)
    const marks = createSelfWriteMarks({
        now: () => env.t,
        debounceMs: () => 250,
        graceMs: 2000,
        stampOf: p => disk.get(p) ?? null,
    })
    return { env, disk, write, marks }
}

// The bug this file exists to catch: markSelfWritten's expiry used to be fixed at MARK time
// (before the write) + the debounce, so a write slower than the debounce let its own echo
// through as a second, spurious structural change. fileWatchDebounceMs has a schema `min: 50`,
// and watcher latency isn't controllable from a test, so this can't be forced red through a real
// server — it's proven here on the pure module instead.
test('a write slower than the debounce still swallows its own echo', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md']) // before the write
    env.t = 400 // the write took 400ms — longer than the 250ms debounce
    write('a.md')
    marks.rearm(['a.md']) // after the write resolves
    env.t = 1200 // the watcher echo lands 800ms later
    expect(marks.consume('a.md')).toBe(true)
})

// Measured under suite load: FSEvents delivered ONE API write as two events ~50ms apart. Swallowing
// only the first let the second publish a spurious extra SSE wave.
test('a write the watcher reports twice has both echoes swallowed', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md'])
    write('a.md')
    marks.rearm(['a.md'])
    env.t = 10
    expect(marks.consume('a.md')).toBe(true)
    env.t = 60
    expect(marks.consume('a.md')).toBe(true)
})

test('echoes that arrive while the write is still in flight are swallowed too', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md'])
    write('a.md') // first chunk — the watcher fires before the write resolves
    expect(marks.consume('a.md')).toBe(true)
    env.t = 20
    write('a.md') // rest of the same write
    expect(marks.consume('a.md')).toBe(true)
    marks.rearm(['a.md'])
    expect(marks.consume('a.md')).toBe(true) // a late echo, file still as the write left it
})

test('an external edit after our write is reported, and ends suppression', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md'])
    write('a.md')
    marks.rearm(['a.md'])
    expect(marks.consume('a.md')).toBe(true) // our echo
    env.t = 500
    write('a.md') // someone else — the CLI, an agent, git
    expect(marks.consume('a.md')).toBe(false)
    expect(marks.consume('a.md')).toBe(false)
})

test('an unmarked failed write never swallows a later external change', () => {
    const { marks } = setup()
    marks.mark(['a.md'])
    marks.unmark(['a.md'])
    expect(marks.consume('a.md')).toBe(false)
})

test('a fast write within the debounce still swallows its echo (unchanged behaviour)', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md'])
    env.t = 50 // the write resolved quickly
    write('a.md')
    marks.rearm(['a.md'])
    env.t = 100 // echo lands well inside the window
    expect(marks.consume('a.md')).toBe(true)
})

test('a mark expires: a matching echo after the grace window is reported', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md'])
    write('a.md')
    marks.rearm(['a.md'])
    env.t = 2001
    expect(marks.consume('a.md')).toBe(false)
})

test('consuming an unmarked path is false and does not throw', () => {
    const { marks } = setup()
    expect(marks.consume('never-marked.md')).toBe(false)
})

// Wave 3 review finding I1: a multi-path write (e.g. POST /set-properties dragging several
// kanban cards, each a separate writeNote) marks a batch of paths together, but the watcher can
// deliver one path's echo (consuming it) WHILE a later path in the same batch is still being
// written. A genuine external edit to that first path before the batch resolves must not be
// adopted by rearm() as our own state and swallowed.
test('rearm does not adopt an external edit made after a batch path was already echoed', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md', 'b.md']) // batch write starts
    write('a.md')
    // the watcher echoes a.md's write while b.md is still being written
    expect(marks.consume('a.md')).toBe(true)
    write('a.md') // an external edit lands before the batch resolves
    write('b.md')
    marks.rearm(['a.md', 'b.md'])
    env.t = 1500
    expect(marks.consume('a.md')).toBe(false)
    expect(marks.consume('b.md')).toBe(true)
})

test('rearm keeps a batch path whose echoed state is unchanged', () => {
    const { env, write, marks } = setup()
    marks.mark(['a.md', 'b.md'])
    write('a.md')
    expect(marks.consume('a.md')).toBe(true)
    write('b.md')
    marks.rearm(['a.md', 'b.md'])
    env.t = 1500
    expect(marks.consume('a.md')).toBe(true) // a late duplicate echo of our own write
})

test('a delete is matched as a missing file', () => {
    const { disk, marks } = setup()
    disk.set('a.md', 'v0')
    marks.mark(['a.md'])
    disk.delete('a.md')
    marks.rearm(['a.md'])
    expect(marks.consume('a.md')).toBe(true)
    expect(marks.consume('a.md')).toBe(true)
    disk.set('a.md', 'recreated')
    expect(marks.consume('a.md')).toBe(false)
})
