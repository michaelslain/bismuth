// app/src/preview/ScratchTextLayer.tsx
// Click-to-place note blocks on a PDF/image's scratch strip. Mounted INSIDE PdfPages' `overlay`
// between HighlightLayer and PageInk, and over the image body, in the same host coordinate space
// PageInk.tsx documents: `inset: 0` over the element that positions the pages. In BOTH mount sites,
// PageInk mounts AFTER this layer (above it in DOM order), so in draw mode ink draws over everything
// while this layer is inert.
//
// Persistence is the caller's CompanionStore (annotationTypes.ts) — the ONE owner of the binary's
// companion note. This layer only reads `blocks()` and calls add/update/remove.
//
// THE GEOMETRY lives in scratchGeometry.ts (pure, unit-tested): a block is (page, logical x, y, w)
// in the ink's 816x1056 logical page space, so it stays beside its passage at any zoom.
//
// INTERACTION (only while `interactive()`; otherwise hit areas and blocks take no pointer events):
//   • pointerdown (primary) on a page's strip hit area while no block is focused → `placeAt` →
//     `addBlock` with empty text, and that block mounts focused. The hit area's pointerdown is
//     preventDefault'ed so a click on the strip never starts a PDF text selection — only there,
//     never inside a block's editor.
//   • pointerdown on a strip hit area while a block IS focused ends that edit (blurs it) instead
//     of placing another block — a second click on the now-unfocused strip is what places one.
//   • focus leaving a block whose text is blank → `removeBlock`.
//   • the block's X → `removeBlock`.
//   • the block's move handle → the block follows the pointer; on release `dropAt` re-anchors it on
//     the strip under the pointer, or it snaps back when the pointer is over no strip.
//
// MOUNTING: blocks are keyed by id (so typing never remounts an editor), wrapped in a key on the
// store's `revision()` (so a reload from disk remounts every block and re-seeds its seed-only
// text), and blocks on pages outside `visibleRange()` are not mounted at all.
import {
    batch,
    createEffect,
    createMemo,
    createSignal,
    For,
    Index,
    Show,
    untrack,
} from 'solid-js'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import { pageBoxFor, type LogicalBox } from '../../../core/src/drawing/pageInk'
import type { NoteCandidate } from '../editor/wikilink'
import type { CompanionStore } from './annotationTypes'
import type { PageInkPage } from './PageInk'
import ScratchBlock from './ScratchBlock'
import ScratchHint from './ScratchHint'
import { blockScreenRect, dropAt, placeAt } from './scratchGeometry'
import styles from './ScratchTextLayer.module.css'

export type ScratchTextLayerProps = {
    store: CompanionStore
    /** Same measured pages PageInk gets (host coordinate space, `inset: 0` over the page stack). */
    pages: () => PageInkPage[]
    /** The `.draw` doc, for `pageBoxFor(doc, i, nat)` — null = no sidecar yet. */
    doc: () => DrawingDoc | null
    /** Blocks + hit areas take pointer events only while true. */
    interactive: () => boolean
    /** Inclusive range of pages near the viewport; blocks outside it are not mounted. Absent = all. */
    visibleRange?: () => [number, number]
    class?: string
    /** Completion sources for each block's MarkdownField wikilink/tag autocomplete —
     *  pass-through to ScratchBlock. Absent = no completion popup (today's behaviour). */
    noteNames?: () => NoteCandidate[]
    tagNames?: () => string[]
    /** The note path a scratch note's links resolve against — the binary itself has none, so
     *  callers pass `null`. */
    notePath?: string | null
}

/** A block mid-drag: the grab offset (pointer minus the block's top-left, host px) and where its
 *  top-left is being previewed. */
type Drag = {
    id: string
    offX: number
    offY: number
    left: number
    top: number
}

function ScratchTextLayer(props: ScratchTextLayerProps) {
    let root!: HTMLDivElement

    // `pageBoxFor` needs A DrawingDoc even for the fit box of a page with no legacy image.
    const boxFor = (i: number, page: PageInkPage): LogicalBox =>
        pageBoxFor(props.doc() ?? emptyDoc(), i, page.nat.w, page.nat.h)
    const boxes = () => props.pages().map((p, i) => boxFor(i, p))

    const [focusId, setFocusId] = createSignal<string | null>(null)
    const [drag, setDrag] = createSignal<Drag | null>(null)

    const inRange = (page: number) => {
        const r = props.visibleRange?.()
        return !r || (page >= r[0] && page <= r[1])
    }

    /** Ids of the blocks to mount — strings, so `<For>` keeps each editor across text edits. A page
     *  with no strip (marginW <= 0, e.g. SCRATCH off) mounts none of its blocks: they would otherwise
     *  render past the page's right edge with nothing there to hold them. */
    const mountedIds = createMemo(() =>
        props.store
            .blocks()
            .filter(
                b =>
                    inRange(b.page) &&
                    (props.pages()[b.page]?.marginW ?? 0) > 0,
            )
            .map(b => b.id),
    )

    const blockById = (id: string) =>
        props.store.blocks().find(b => b.id === id)

    /** The first page with a strip, for the empty-strip hint — null when none has one. */
    const firstStrip = createMemo(() => {
        const i = props.pages().findIndex(p => (p.marginW ?? 0) > 0)
        return i < 0 ? null : props.pages()[i]!
    })

    // A block being dragged is drawn at its preview position regardless of the mounted list. If it
    // unmounts mid-drag (scrolled out of visibleRange, or its page's strip goes away) or the store
    // reloads from disk (a revision bump remounts every block and re-seeds its text), the preview
    // would otherwise keep drawing at a now-stale position — clear the drag.
    createEffect(() => {
        const ids = new Set(mountedIds())
        const current = untrack(drag)
        if (current && !ids.has(current.id)) setDrag(null)
    })
    createEffect(() => {
        props.store.revision()
        setDrag(null)
    })

    const onHitDown = (e: PointerEvent, i: number) => {
        if (e.button !== 0 || !props.interactive()) return
        const page = props.pages()[i]
        if (!page) return
        // A click on the strip while a note is being edited ENDS that edit and places nothing —
        // a second click on empty strip is what makes the next note. Without this, every
        // click-away left a fresh empty box behind (and `onLeave` then removed the one you had
        // just blurred, not the new one).
        const active = document.activeElement
        if (active instanceof HTMLElement && root.contains(active) && active !== root) {
            e.preventDefault()
            active.blur()
            return
        }
        e.preventDefault()
        const host = root.getBoundingClientRect()
        const placed = placeAt(
            i,
            page,
            boxFor(i, page),
            e.clientX - host.left,
            e.clientY - host.top,
        )
        // Batched so the new block's autofocus prop is already true when it mounts.
        batch(() => {
            const id = props.store.addBlock({ ...placed, text: '' })
            setFocusId(id)
        })
    }

    const onLeave = (id: string) => {
        if (focusId() === id) setFocusId(null)
        const b = blockById(id)
        if (b && b.text.trim() === '') props.store.removeBlock(id)
    }

    const onDragMove = (id: string, hx: number, hy: number) => {
        const d = drag()
        if (d?.id === id) {
            setDrag({ ...d, left: hx - d.offX, top: hy - d.offY })
            return
        }
        const b = blockById(id)
        const page = b && props.pages()[b.page]
        if (!b || !page) return
        const r = blockScreenRect(b, page, boxFor(b.page, page))
        setDrag({
            id,
            offX: hx - r.left,
            offY: hy - r.top,
            left: r.left,
            top: r.top,
        })
    }

    const onDragEnd = (id: string, hx: number, hy: number) => {
        const d = drag()
        const b = blockById(id)
        setDrag(null)
        if (!d || d.id !== id || !b) return
        const to = dropAt(
            props.pages(),
            boxes(),
            b,
            hx,
            hy,
            hx - d.offX,
            hy - d.offY,
        )
        if (to) props.store.updateBlock(id, to)
    }

    return (
        <div
            ref={root}
            class={`${styles.layer} ${props.class ?? ''}`}
            classList={{ [styles.interactive]: props.interactive() }}
            data-scratch-text
            data-testid="scratch-text-layer"
        >
            <Index each={props.pages()}>
                {(page, i) => (
                    <Show when={(page().marginW ?? 0) > 0}>
                        <div
                            class={styles.hit}
                            data-scratch-hit={i}
                            style={{
                                left: `${page().rendered.left + page().rendered.w}px`,
                                top: `${page().rendered.top}px`,
                                width: `${page().marginW}px`,
                                height: `${page().rendered.h}px`,
                            }}
                            onPointerDown={e => onHitDown(e, i)}
                        />
                    </Show>
                )}
            </Index>
            {/* Nothing else tells a person the blank strip takes typing — removed the instant any
                block exists, and only while interactive (draw mode etc. shows no affordance for an
                action it doesn't accept). */}
            <Show
                when={
                    props.interactive() &&
                    props.store.blocks().length === 0 &&
                    firstStrip()
                }
            >
                {page => (
                    <ScratchHint
                        left={page().rendered.left + page().rendered.w}
                        top={page().rendered.top}
                    />
                )}
            </Show>
            {/* A one-item list keyed on the revision number: a new revision is a new item, so
                every block below remounts and re-seeds. */}
            <For each={[props.store.revision()]}>
                {() => (
                    <For each={mountedIds()}>
                        {id => {
                            const block = createMemo(() => blockById(id))
                            const rect = createMemo(() => {
                                const b = block()
                                const page = b && props.pages()[b.page]
                                if (!b || !page) return undefined
                                const r = blockScreenRect(
                                    b,
                                    page,
                                    boxFor(b.page, page),
                                )
                                const d = drag()
                                return d?.id === id
                                    ? { ...r, left: d.left, top: d.top }
                                    : r
                            })
                            return (
                                <Show when={block() && rect()}>
                                    <ScratchBlock
                                        block={block()!}
                                        rect={rect()!}
                                        autofocus={focusId() === id}
                                        interactive={props.interactive()}
                                        onText={text =>
                                            props.store.updateBlock(id, {
                                                text,
                                            })
                                        }
                                        onLeave={() => onLeave(id)}
                                        onDelete={() => {
                                            if (focusId() === id)
                                                setFocusId(null)
                                            props.store.removeBlock(id)
                                        }}
                                        onDragMove={(hx, hy) =>
                                            onDragMove(id, hx, hy)
                                        }
                                        onDragEnd={(hx, hy) =>
                                            onDragEnd(id, hx, hy)
                                        }
                                        noteNames={props.noteNames}
                                        tagNames={props.tagNames}
                                        notePath={props.notePath}
                                    />
                                </Show>
                            )
                        }}
                    </For>
                )}
            </For>
        </div>
    )
}

export default ScratchTextLayer
