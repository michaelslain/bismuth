// app/src/FileTree.refresh.test.ts
//
// Regression for B3: the file-tree's SSE-driven refresh must not clobber an
// optimistic move/rename/create/delete with a stale /tree snapshot taken before
// the mutation landed on the server. FileTree gates the refetch on editing /
// dragging / `pendingOps` (count of in-flight optimistic ops). While any holds,
// the decision is to DEFER — return refetch:false WITHOUT advancing `lastSeen`,
// so the change is re-applied once the guard clears (the effect re-runs because
// those signals are tracked).
//
// We test the pure decision function `decideTreeRefresh` directly, threading
// `lastSeen` (and, for Task 5, `pendingStructural`) the way the effect does, so
// the assertions don't depend on Solid's (asynchronous) effect scheduling.
//
// `decideTreeRefresh` is a pure function extracted to its own module, so this test
// imports it directly — no need to load the FileTree component (which pulls in
// Solid client-only code / CodeMirror and opens an EventSource at module load).
import { describe, expect, it, test } from 'bun:test'
import { decideTreeRefresh } from './fileTreeRefresh'

const idle = { editing: false, dragging: false, pendingOps: 0 }

describe('decideTreeRefresh (B3 gating)', () => {
    it('refetches on a fresh structural change when idle, advancing lastSeen', () => {
        const d = decideTreeRefresh({
            change: { version: 1 },
            lastSeen: 0,
            ...idle,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: true,
            nextLastSeen: 1,
            nextPendingStructural: false,
        })
    })

    it('ignores a version it has already seen', () => {
        const d = decideTreeRefresh({
            change: { version: 3 },
            lastSeen: 3,
            ...idle,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: false,
            nextLastSeen: 3,
            nextPendingStructural: false,
        })
    })

    it('DEFERS while an optimistic op is in flight (no refetch, lastSeen unchanged)', () => {
        const d = decideTreeRefresh({
            change: { version: 1 },
            lastSeen: 0,
            ...idle,
            pendingOps: 1,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: false,
            nextLastSeen: 0,
            nextPendingStructural: true,
        })
    })

    it('catches up exactly once after the op settles, using the deferred version', () => {
        // Mid-flight: stale snapshot arrives, deferred (lastSeen stays 0).
        const mid = decideTreeRefresh({
            change: { version: 1 },
            lastSeen: 0,
            ...idle,
            pendingOps: 1,
            pendingStructural: false,
        })
        expect(mid).toEqual({
            refetch: false,
            nextLastSeen: 0,
            nextPendingStructural: true,
        })
        // Op settles → effect re-runs with the SAME change; now it refetches.
        const after = decideTreeRefresh({
            change: { version: 1 },
            lastSeen: mid.nextLastSeen,
            ...idle,
            pendingStructural: mid.nextPendingStructural,
        })
        expect(after).toEqual({
            refetch: true,
            nextLastSeen: 1,
            nextPendingStructural: false,
        })
        // A spurious re-run on the now-consumed version must not refetch again.
        const again = decideTreeRefresh({
            change: { version: 1 },
            lastSeen: after.nextLastSeen,
            ...idle,
            pendingStructural: after.nextPendingStructural,
        })
        expect(again).toEqual({
            refetch: false,
            nextLastSeen: 1,
            nextPendingStructural: false,
        })
    })

    it('still defers while editing and while dragging (pre-existing behavior)', () => {
        expect(
            decideTreeRefresh({
                change: { version: 1 },
                lastSeen: 0,
                ...idle,
                editing: true,
                pendingStructural: false,
            }),
        ).toEqual({
            refetch: false,
            nextLastSeen: 0,
            nextPendingStructural: true,
        })
        expect(
            decideTreeRefresh({
                change: { version: 1 },
                lastSeen: 0,
                ...idle,
                dragging: true,
                pendingStructural: false,
            }),
        ).toEqual({
            refetch: false,
            nextLastSeen: 0,
            nextPendingStructural: true,
        })
    })

    it('skips a content-only change (dirty.tree === false) but consumes the version', () => {
        const d = decideTreeRefresh({
            change: { version: 1, dirty: { tree: false } },
            lastSeen: 0,
            ...idle,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: false,
            nextLastSeen: 1,
            nextPendingStructural: false,
        })
    })

    it('refetches when dirty is absent (poll/reconnect: extent unknown)', () => {
        const d = decideTreeRefresh({
            change: { version: 2 },
            lastSeen: 1,
            ...idle,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: true,
            nextLastSeen: 2,
            nextPendingStructural: false,
        })
    })

    it('refetches a structural change (dirty.tree === true)', () => {
        const d = decideTreeRefresh({
            change: { version: 2, dirty: { tree: true } },
            lastSeen: 1,
            ...idle,
            pendingStructural: false,
        })
        expect(d).toEqual({
            refetch: true,
            nextLastSeen: 2,
            nextPendingStructural: false,
        })
    })

    test('a structural change seen while deferred is not lost behind a later content-only change', () => {
        let s = decideTreeRefresh({
            change: { version: 2, dirty: { tree: true } },
            lastSeen: 1,
            editing: true,
            dragging: false,
            pendingOps: 0,
            pendingStructural: false,
        })
        expect(s.refetch).toBe(false)
        expect(s.nextPendingStructural).toBe(true)
        s = decideTreeRefresh({
            change: { version: 3, dirty: { tree: false } },
            lastSeen: s.nextLastSeen,
            editing: false,
            dragging: false,
            pendingOps: 0,
            pendingStructural: s.nextPendingStructural,
        })
        expect(s.refetch).toBe(true)
        expect(s.nextPendingStructural).toBe(false)
    })
})
