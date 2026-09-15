// app/src/preview/createAnnotationStore.stories.tsx
// Behavioural spec for createAnnotationStore.ts — NOT a visual component (see taskStatusMenu
// .stories.tsx for the same shape: a `Meta` with no `component`, just `title`). Storybook is
// used here purely because it's the one surface in this repo where solid-js's REAL reactive
// build runs: bare `solid-js` under `bun test` resolves to its SSR/server build (verified while
// writing these fixes — `createEffect` never fires there, at all, even once), the same trap
// documented for `solid-js/web` elsewhere in this codebase. A pure `.test.ts` therefore can't
// exercise createAnnotationStore's reload effect or `edit`'s undo/save side effects; only a real
// browser can.
//
// Two chunk-1-review findings, both about a safety property the OLD code only claimed:
//   1. the reload effect was keyed off the RAW `sidecarPath`/`binaryPath` accessors, and `on()`
//      has no equality check of its own — a re-notify carrying the IDENTICAL path string still
//      flushed, reset undo and re-read the sidecar. Fixed by memoizing both inside the store.
//   2. `edit()` pushed an undo entry and scheduled a save even when `fn` handed back its input
//      doc UNCHANGED — including synthesizing and then writing a brand-new empty `.draw`
//      sidecar for a no-op edit on a file that had none yet, breaking the documented "nothing is
//      written until the user actually edits" contract.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import createAnnotationStore from './createAnnotationStore'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { emptyDoc, serializeDoc } from '../../../core/src/drawing/model'
import type { AnnotationStore } from './annotationTypes'

const meta = {
    title: 'Preview/AnnotationStore',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** No `waitFor`-able DOM signal to key off (there's nothing to render) — a short real delay past
 *  the store's own microtask/promise chain (the fake transport resolves synchronously-ish, but
 *  `api.read`/`api.saveDrawing` still go through real Promises). */
const settle = () => new Promise<void>(r => setTimeout(r, 30))

// ── ReloadEffectIsMemoized ───────────────────────────────────────────────────────────────────

const RELOAD_SIDECAR = 'docs/reload.pdf.draw'
let reads = 0
let pathSetter: ((p: string) => void) | undefined
let storeForReloadTest: AnnotationStore | undefined

/** Mounts the real store under a real Solid owner (needed for its `onCleanup`s) with a `path`
 *  signal this story's play() can re-fire from outside. `equals: false` matters: a PLAIN
 *  `createSignal` already dedupes identical values at the signal level, which would make this
 *  story pass whether or not the store memoizes internally — it wouldn't be testing anything.
 *  The real-world caller this guards against (per the diagnosis) is an accessor sitting
 *  downstream of something that re-notifies on every parent render regardless of value; `equals:
 *  false` reproduces exactly that "always notify" shape without needing to build one. */
function ReloadHost() {
    const [path, setPath] = createSignal(RELOAD_SIDECAR, { equals: false })
    pathSetter = setPath
    const store = createAnnotationStore(path, () => 'docs/reload.pdf')
    storeForReloadTest = store
    // Visible text, not just an empty div — there's no UI here to look at (play() asserts
    // directly against the store instance), but the story audit's "empty render" check
    // (correctly) treats a fully blank root as suspicious, so the store's own live loadState is
    // shown instead of a decoy.
    return (
        <div data-testid="annotation-store-host">loadState: {store.loadState()}</div>
    )
}

/** A caller's `sidecarPath` accessor re-notifying with the SAME string (exactly what happens
 *  when it sits downstream of a parent re-render, per the diagnosis) must not re-read the
 *  sidecar a second time. */
export const ReloadEffectIsMemoized: Story = {
    render: () => {
        reads = 0
        storeForReloadTest = undefined
        const t = fakeTransport({
            files: { [RELOAD_SIDECAR]: serializeDoc(emptyDoc()) },
        })
        const originalGetText = t.getText.bind(t)
        t.getText = (p: string) => {
            reads++
            return originalGetText(p)
        }
        setTransport(t)
        return <ReloadHost />
    },
    play: async () => {
        await waitFor(
            () => {
                expect(storeForReloadTest?.loadState()).toBe('ready')
            },
            { timeout: 5000 },
        )
        expect(reads).toBe(1)

        // Re-notify with the IDENTICAL string.
        pathSetter?.(RELOAD_SIDECAR)
        await settle()
        expect(reads).toBe(1)
        expect(storeForReloadTest?.loadState()).toBe('ready')
    },
}

// ── EditNoOpsWhenUnchanged ───────────────────────────────────────────────────────────────────

const NOOP_SIDECAR = 'assets/noop.png.draw'
let putCalls = 0
let storeForEditTest: AnnotationStore | undefined

function EditHost() {
    const store = createAnnotationStore(() => NOOP_SIDECAR, () => 'assets/noop.png')
    storeForEditTest = store
    return (
        <div data-testid="annotation-store-host">loadState: {store.loadState()}</div>
    )
}

/** `edit(d => d)` — the shape `addHighlight`/`removeHighlight`/`removeBookmark` return when
 *  there's nothing to change — must save nothing and push no undo entry, whether or not a doc
 *  already exists. A real edit alongside it proves the guard isn't just refusing everything. */
export const EditNoOpsWhenUnchanged: Story = {
    render: () => {
        putCalls = 0
        storeForEditTest = undefined
        const t = fakeTransport({ files: {} })
        const originalPut = t.put.bind(t)
        t.put = (p, body) => {
            putCalls++
            return originalPut(p, body)
        }
        setTransport(t)
        return <EditHost />
    },
    play: async () => {
        await waitFor(
            () => {
                expect(storeForEditTest?.loadState()).toBe('ready')
            },
            { timeout: 5000 },
        )
        const store = storeForEditTest!

        // No doc yet: a no-op edit must not synthesize and then save a blank sidecar. `flush()`,
        // not `settle()` (final review — the save is debounced 600ms, so the previous 30ms
        // `settle()` here could never actually observe a save that DID happen): `flush()` clears
        // the timer and, per createAnnotationStore.ts, resolves as a no-op UNLESS `edit` actually
        // set `dirty` — so this proves the guard by the store's own accounting, not by outrunning
        // a timer.
        store.edit(d => d)
        await store.flush()
        expect(putCalls).toBe(0)
        expect(store.doc()).toBeNull()
        store.undo() // nothing was ever pushed
        expect(store.doc()).toBeNull()

        // A real edit DOES save and push undo — and, unlike a fresh blank doc, is observably
        // DIFFERENT (a highlight), so later assertions can tell "reverted all the way back" from
        // "reverted to a doc that happens to look the same".
        store.edit(d => ({
            ...d,
            pages: [
                {
                    strokes: [],
                    highlights: [
                        { id: 'h1', c: 'hl', rects: [{ x: 0, y: 0, w: 10, h: 10 }] },
                    ],
                },
            ],
        }))
        await waitFor(
            () => {
                expect(putCalls).toBeGreaterThan(0)
            },
            { timeout: 2000 },
        )
        const callsAfterRealEdit = putCalls
        expect(store.doc()?.pages[0]?.highlights).toHaveLength(1)

        // Now a no-op edit on an EXISTING doc — the more common real caller shape
        // (addHighlight with empty rects, removeHighlight/removeBookmark on an id that isn't
        // there). Must not save again, and must not push a SECOND undo entry: one undo() should
        // land all the way back at the pre-real-edit blank doc (no highlight), not merely back
        // at the same edited doc — which is what an extra undo entry from the no-op would give.
        store.edit(d => d)
        await store.flush()
        expect(putCalls).toBe(callsAfterRealEdit)
        store.undo()
        expect(store.doc()?.pages[0]?.highlights ?? []).toHaveLength(0)
    },
}
