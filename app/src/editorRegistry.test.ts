// app/src/editorRegistry.test.ts
// Covers ONLY the sidecar-flush registry (registerSidecarFlush / flushSidecarsAtOrUnder) —
// chunk-1 review item 7. The CodeMirror-backed flushers (registerEditor, flushEditorsAtOrUnder,
// …) need a real EditorView and are exercised through the editor's own integration paths
// instead; this file is what the review called "pure enough to unit test" for the new,
// non-CodeMirror half added here. Every test registers under its own unique path so module-level
// state (the registry is a module singleton) never leaks between tests.
import { describe, it, expect } from 'bun:test'
import { registerSidecarFlush, flushSidecarsAtOrUnder } from './editorRegistry'

describe('registerSidecarFlush / flushSidecarsAtOrUnder', () => {
    it('calls a flusher registered under an exact path match', async () => {
        let called = 0
        registerSidecarFlush('a/exact.png', async () => {
            called++
        })
        await flushSidecarsAtOrUnder('a/exact.png')
        expect(called).toBe(1)
    })

    it('does not call a flusher for an unrelated path', async () => {
        let called = 0
        registerSidecarFlush('b/one.png', async () => {
            called++
        })
        await flushSidecarsAtOrUnder('b/two.png')
        expect(called).toBe(0)
    })

    it('matches a binary under a folder being moved/deleted (isUnder semantics)', async () => {
        let called = 0
        registerSidecarFlush('c/sub/photo.png', async () => {
            called++
        })
        await flushSidecarsAtOrUnder('c/sub')
        expect(called).toBe(1)
    })

    it('does NOT match a string-prefix collision without a folder boundary', async () => {
        // 'd/x.png2' is not a descendant of 'd/x.png' (no '/' between them) — the same
        // folder-prefix semantics flushEditorsAtOrUnder already relies on.
        let called = 0
        registerSidecarFlush('d/x.png2', async () => {
            called++
        })
        await flushSidecarsAtOrUnder('d/x.png')
        expect(called).toBe(0)
    })

    it('calls every flusher registered under the same binary path (PageInk + CompanionFrontmatter both mounted)', async () => {
        let inkCalls = 0
        let tagCalls = 0
        registerSidecarFlush('e/both.png', async () => {
            inkCalls++
        })
        registerSidecarFlush('e/both.png', async () => {
            tagCalls++
        })
        await flushSidecarsAtOrUnder('e/both.png')
        expect(inkCalls).toBe(1)
        expect(tagCalls).toBe(1)
    })

    it('awaits the flusher — a caller cannot proceed before the write settles', async () => {
        const order: string[] = []
        registerSidecarFlush('f/slow.png', async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
            order.push('flushed')
        })
        await flushSidecarsAtOrUnder('f/slow.png')
        order.push('after')
        expect(order).toEqual(['flushed', 'after'])
    })

    it('unregister() (the function registerSidecarFlush returns) stops future flushes from finding it', async () => {
        let called = 0
        const unregister = registerSidecarFlush('g/gone.png', async () => {
            called++
        })
        unregister()
        await flushSidecarsAtOrUnder('g/gone.png')
        expect(called).toBe(0)
    })

    it('unregistering one of two flushers under the same key leaves the other registered', async () => {
        let aCalls = 0
        let bCalls = 0
        const unregisterA = registerSidecarFlush('h/two.png', async () => {
            aCalls++
        })
        registerSidecarFlush('h/two.png', async () => {
            bCalls++
        })
        unregisterA()
        await flushSidecarsAtOrUnder('h/two.png')
        expect(aCalls).toBe(0)
        expect(bCalls).toBe(1)
    })

    it('resolves with nothing to do when no flusher is registered at all', async () => {
        await expect(
            flushSidecarsAtOrUnder('i/nothing-here.png'),
        ).resolves.toBeUndefined()
    })
})
