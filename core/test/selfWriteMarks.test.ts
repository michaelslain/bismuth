// core/test/selfWriteMarks.test.ts
//
// Pure unit tests for the self-write mark/rearm/consume/unmark logic, extracted out of
// server.ts so its expiry semantics are testable without a real filesystem watcher or debounce
// timer. See core/src/selfWriteMarks.ts for the design.
import { test, expect } from 'bun:test'
import { createSelfWriteMarks } from '../src/selfWriteMarks'

// The bug this file exists to catch: markSelfWritten's expiry used to be fixed at MARK time
// (before the write) + the debounce, so a write slower than the debounce let its own echo
// through as a second, spurious structural change. fileWatchDebounceMs has a schema `min: 50`,
// and watcher latency isn't controllable from a test, so this can't be forced red through a real
// server — it's proven here on the pure module instead.
test('a write slower than the debounce still swallows its own echo', () => {
    let t = 0
    const marks = createSelfWriteMarks({
        now: () => t,
        debounceMs: () => 250,
        graceMs: 2000,
    })
    marks.mark(['a.md']) // before the write
    t = 400 // the write took 400ms — longer than the 250ms debounce
    marks.rearm(['a.md']) // after the write resolves
    t = 1200 // the watcher echo lands 800ms later
    expect(marks.consume('a.md')).toBe(true)
    expect(marks.consume('a.md')).toBe(false) // only the first echo is swallowed
})

test('an unmarked failed write never swallows a later external change', () => {
    let t = 0
    const marks = createSelfWriteMarks({
        now: () => t,
        debounceMs: () => 250,
        graceMs: 2000,
    })
    marks.mark(['a.md'])
    marks.unmark(['a.md'])
    expect(marks.consume('a.md')).toBe(false)
})

test('a fast write within the debounce still swallows its echo (unchanged behaviour)', () => {
    let t = 0
    const marks = createSelfWriteMarks({
        now: () => t,
        debounceMs: () => 250,
        graceMs: 2000,
    })
    marks.mark(['a.md'])
    t = 50 // the write resolved quickly
    marks.rearm(['a.md'])
    t = 100 // echo lands well inside the window
    expect(marks.consume('a.md')).toBe(true)
})

test('consuming an unmarked path is false and does not throw', () => {
    const marks = createSelfWriteMarks({
        now: () => 0,
        debounceMs: () => 250,
        graceMs: 2000,
    })
    expect(marks.consume('never-marked.md')).toBe(false)
})

// Wave 3 review finding I1: a multi-path write (e.g. POST /set-properties dragging several
// kanban cards, each a separate writeNote) marks a batch of paths together, but the watcher can
// deliver one path's echo (consuming it) WHILE a later path in the same batch is still being
// written. rearm() was then called for the whole batch unconditionally, resurrecting the
// already-consumed entry for a fresh 2s window — during which a genuine external edit to that
// same path is silently swallowed as if it were our own echo.
test('rearm does not resurrect an entry the watcher already consumed', () => {
    let t = 0
    const marks = createSelfWriteMarks({
        now: () => t,
        debounceMs: () => 250,
        graceMs: 2000,
    })
    marks.mark(['a.md', 'b.md']) // batch write starts
    // the watcher echoes a.md's write while b.md is still being written
    expect(marks.consume('a.md')).toBe(true)
    // the whole batch's write resolves; rearm is called for every path in it
    marks.rearm(['a.md', 'b.md'])
    t = 1500
    // a.md must NOT be armed again — it already did its job. A real external edit landing here
    // must schedule normally, not be swallowed as a phantom second echo.
    expect(marks.consume('a.md')).toBe(false)
})
