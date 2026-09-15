// app/src/preview/createCompanionStore.stories.tsx
// Behavioural spec for createCompanionStore.ts — NOT a visual component (see createAnnotation
// Store.stories.tsx for the same shape: a `Meta` with no `component`, just `title`). Storybook is
// used here purely because it's the one surface in this repo where solid-js's REAL reactive build
// runs — bare `solid-js` under `bun test` resolves to its SSR/server build, so a pure `.test.ts`
// can't exercise this store's reload effect or its debounced-save side effects; only a real
// browser can.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import createCompanionStore from './createCompanionStore'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { settings } from '../settings'
import { companionPathFor } from '../../../core/src/fileKinds'
import type { CompanionStore } from './annotationTypes'
import { toasts } from '../toastStore'

const meta = {
    title: 'Preview/CompanionStore',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** No `waitFor`-able DOM signal to key most of this off (there's little to render) — a short real
 *  delay past the store's own microtask/promise chain, for the handful of assertions that aren't
 *  otherwise observable through `loadState`/`revision`. */
const settle = (ms = 30) => new Promise<void>(r => setTimeout(r, ms))

/** Mounts the real store under a real Solid owner (needed for its `onCleanup`s), captures it on a
 *  module-level variable this story's play() can read, and renders its live `loadState` so the
 *  story audit's "empty render" check doesn't flag a blank root (there's no UI here — play()
 *  drives the store instance directly). */
function Host(props: {
    binaryPath: () => string
    onStore: (s: CompanionStore) => void
}) {
    const store = createCompanionStore(props.binaryPath)
    props.onStore(store)
    return (
        <div data-testid="companion-store-host">
            loadState: {store.loadState()}
        </div>
    )
}

// ── TagsAndBlocksSurviveSave ────────────────────────────────────────────────────────────────────

const SAVE_PATH = 'book.pdf'
let storeForSaveTest: CompanionStore | undefined

/** A tag edit AND a real block both land in one write, and both are still there on read-back —
 *  the store never lets one half's save drop the other's content. */
export const TagsAndBlocksSurviveSave: Story = {
    render: () => {
        storeForSaveTest = undefined
        setTransport(fakeTransport({ files: {} }))
        return (
            <Host
                binaryPath={() => SAVE_PATH}
                onStore={s => {
                    storeForSaveTest = s
                }}
            />
        )
    },
    play: async () => {
        await waitFor(() => {
            expect(storeForSaveTest?.loadState()).toBe('ready')
        })
        const store = storeForSaveTest!

        store.setFrontmatter('---\ntags: [trip]\n---\n')
        store.addBlock({ page: 0, x: 700, y: 100, w: 200, text: 'hello' })
        await store.flush()

        const written = await api.read(companionPathFor(SAVE_PATH))
        expect(written).toContain('tags: [trip]')
        expect(written).toContain('hello')
        expect(written).toContain('<!-- scratch id=')
    },
}

// ── MissingCompanionOneBlankBlockWritesNothing ──────────────────────────────────────────────────

const BLANK_PATH = 'blank.png'
let storeForBlankTest: CompanionStore | undefined

/** A missing companion, edited only by adding ONE block and never typing into it, writes nothing
 *  — the untouched-frontmatter half of shouldWriteCompanionDoc and the "every block is blank"
 *  half must both hold at once, not just individually (companionDoc.test.ts covers each alone). */
export const MissingCompanionOneBlankBlockWritesNothing: Story = {
    render: () => {
        storeForBlankTest = undefined
        setTransport(fakeTransport({ files: {} }))
        return (
            <Host
                binaryPath={() => BLANK_PATH}
                onStore={s => {
                    storeForBlankTest = s
                }}
            />
        )
    },
    play: async () => {
        await waitFor(() => {
            expect(storeForBlankTest?.loadState()).toBe('ready')
        })
        const store = storeForBlankTest!

        store.addBlock({ page: 0, x: 0, y: 0, w: 100, text: '' })
        await store.flush()
        // Past the debounce too, not just flush() — nothing scheduled a late write either.
        await settle(settings.editor.autoSaveDelay + 200)

        expect(await api.read(companionPathFor(BLANK_PATH))).toBe('')
    },
}

// ── ConflictReloadBumpsRevision ─────────────────────────────────────────────────────────────────

const CONFLICT_PATH = 'conflict.png'
const CONFLICT_INITIAL = '---\ntags: [a]\n---\n'
let storeForConflictTest: CompanionStore | undefined

/** Someone else's write lands between our read and our write: the store must reload from the
 *  server's `current`, bump `revision` so a keyed view re-seeds, and toast — never silently
 *  clobber the concurrent edit (plan "Rulings"). */
export const ConflictReloadBumpsRevision: Story = {
    render: () => {
        storeForConflictTest = undefined
        setTransport(
            fakeTransport({
                files: {
                    [companionPathFor(CONFLICT_PATH)]: CONFLICT_INITIAL,
                },
            }),
        )
        return (
            <Host
                binaryPath={() => CONFLICT_PATH}
                onStore={s => {
                    storeForConflictTest = s
                }}
            />
        )
    },
    play: async () => {
        await waitFor(() => {
            expect(storeForConflictTest?.loadState()).toBe('ready')
        })
        const store = storeForConflictTest!
        const revisionBeforeConflict = store.revision()

        // Someone else writes the companion out from under us, using the SAME baseText the store
        // itself just read — this write succeeds and leaves the file at ELSEWHERE_TEXT.
        const path = companionPathFor(CONFLICT_PATH)
        const elsewhereText = '---\ntags: [a, elsewhere]\n---\n'
        const elsewhereWrite = await api.writeChecked(
            path,
            elsewhereText,
            CONFLICT_INITIAL,
        )
        expect(elsewhereWrite.conflict).toBe(false)

        // Our own edit now writes against a STALE baseText (the store still thinks the file is
        // CONFLICT_INITIAL) -> a real conflict.
        store.setFrontmatter('---\ntags: [a, mine]\n---\n')
        await store.flush()

        await waitFor(() => {
            expect(store.revision()).toBeGreaterThan(revisionBeforeConflict)
        })
        // Reloaded from the elsewhere-write, not silently overwritten by "mine".
        expect(store.frontmatter()).toBe(elsewhereText)
        expect(await api.read(path)).toBe(elsewhereText)
    },
}

// ── PathSwitchFlushesOldFile ────────────────────────────────────────────────────────────────────

const PATH_A = 'a.png'
const PATH_B = 'b.png'
let storeForSwitchTest: CompanionStore | undefined

/** An edit made on the OLD binary is written before the store moves on to the new one — even
 *  though the debounce window (settings.editor.autoSaveDelay) hasn't elapsed — mirroring
 *  createAnnotationStore's identical path-switch flush. */
export const PathSwitchFlushesOldFile: Story = {
    render: () => {
        storeForSwitchTest = undefined
        setTransport(fakeTransport({ files: {} }))
        const [path, setPath] = createSignal(PATH_A)
        const store = createCompanionStore(path)
        storeForSwitchTest = store
        return (
            <div data-testid="companion-store-host">
                loadState: {store.loadState()}
                <button
                    type="button"
                    data-testid="switch-to-b"
                    onClick={() => setPath(PATH_B)}
                >
                    switch
                </button>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(storeForSwitchTest?.loadState()).toBe('ready')
        })
        const store = storeForSwitchTest!

        store.setFrontmatter('---\ntags: [alpha]\n---\n')
        // Deliberately NOT flushed and NOT past the debounce — the switch itself must flush it.
        ;(
            canvasElement.querySelector(
                '[data-testid="switch-to-b"]',
            ) as HTMLButtonElement
        ).click()

        await waitFor(async () => {
            const written = await api.read(companionPathFor(PATH_A))
            expect(written).toContain('alpha')
        })
        // The new binary loaded cleanly (its own, separate, untouched companion).
        await waitFor(() => {
            expect(store.frontmatter()).toBe('---\ntags: []\n---\n')
        })
    },
}

// ── ClickAndLeaveOnExistingCompanionWritesNothing ───────────────────────────────────────────────

const CLICK_LEAVE_PATH = 'existing.png'
const CLICK_LEAVE_TEXT = '---\ntags: [keep]\n---\nhand-written body.\n'
let storeForClickLeaveTest: CompanionStore | undefined

/** Adding a block and removing it again before the debounce fires — the "click-and-leave" strip
 *  gesture (chunk-1 review) — performs ZERO writes on an EXISTING companion: shouldWriteCompanionDoc
 *  says "existing -> always write" (blocks alone don't override that), so the fix has to be the
 *  no-op check inside the flush itself (`joined === baseText`), not a skip earlier. */
export const ClickAndLeaveOnExistingCompanionWritesNothing: Story = {
    render: () => {
        storeForClickLeaveTest = undefined
        setTransport(
            fakeTransport({
                files: { [companionPathFor(CLICK_LEAVE_PATH)]: CLICK_LEAVE_TEXT },
            }),
        )
        return (
            <Host
                binaryPath={() => CLICK_LEAVE_PATH}
                onStore={s => {
                    storeForClickLeaveTest = s
                }}
            />
        )
    },
    play: async () => {
        await waitFor(() => {
            expect(storeForClickLeaveTest?.loadState()).toBe('ready')
        })
        const store = storeForClickLeaveTest!

        const id = store.addBlock({ page: 0, x: 0, y: 0, w: 100, text: '' })
        store.removeBlock(id)
        await store.flush()
        // Past the debounce too, not just flush() — nothing scheduled a late write either.
        await settle(settings.editor.autoSaveDelay + 200)

        expect(await api.read(companionPathFor(CLICK_LEAVE_PATH))).toBe(
            CLICK_LEAVE_TEXT,
        )
    },
}

// ── OverlappingFlushesBothLandNoConflict ────────────────────────────────────────────────────────

const OVERLAP_PATH = 'overlap.png'
let storeForOverlapTest: CompanionStore | undefined

/** Two edits, the second made while the first's write is still in flight (both flushed directly,
 *  back to back, with no await between them — flush() is called before the first has resolved):
 *  the second write must not read the first's now-stale pre-write base text — that produced a
 *  bogus self-conflict before this fix (chunk-1 review, "chain each flush onto the pending write
 *  promise"). Both edits land, in order, with no "changed elsewhere" toast. */
export const OverlappingFlushesBothLandNoConflict: Story = {
    render: () => {
        storeForOverlapTest = undefined
        setTransport(fakeTransport({ files: {} }))
        return (
            <Host
                binaryPath={() => OVERLAP_PATH}
                onStore={s => {
                    storeForOverlapTest = s
                }}
            />
        )
    },
    play: async () => {
        await waitFor(() => {
            expect(storeForOverlapTest?.loadState()).toBe('ready')
        })
        const store = storeForOverlapTest!
        const toastCountBefore = toasts().length

        store.setFrontmatter('---\ntags: [first]\n---\n')
        const firstFlush = store.flush() // NOT awaited — its write is still in flight below
        store.setFrontmatter('---\ntags: [first, second]\n---\n')
        const secondFlush = store.flush()
        await Promise.all([firstFlush, secondFlush])

        const written = await api.read(companionPathFor(OVERLAP_PATH))
        expect(written).toBe('---\ntags: [first, second]\n---\n')
        // No stale-baseText self-conflict along the way — the toast list gained nothing.
        const newToasts = toasts().slice(toastCountBefore)
        expect(newToasts.some(t => t.message.includes('changed elsewhere'))).toBe(
            false,
        )
    },
}
