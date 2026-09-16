// app/src/preview/ScratchBlock.tsx
// One scratch note pinned beside a PDF/image page: a live-preview markdown field (ui/MarkdownField,
// the same rendered-yet-editable look as a note body) at a host-px rect ScratchTextLayer computes.
//
// It owns no persistence and no geometry. The layer hands it `rect` and gets back text edits, "focus
// left me", delete, and move-handle drags in host px. Text is SEEDED from `block.text` once per
// mount; the layer keys its blocks on the store's `revision`, so a reload from disk remounts and
// re-seeds rather than fighting the caret.
//
// Font scale: the root sets `--scratch-scale` inline and its module rescales `--prose-font-size` by
// it, so MarkdownField's own theme (which reads `var(--prose-font-size)`) renders at the page's zoom.
//
// Chrome — a move handle and a delete X, together in a row ABOVE the block's first text line (never
// on top of the text: CodeMirror's positioned `.cm-editor` paints over anything underneath it, which
// is what made the old corner-overlap grip/X unclickable) — shows only on hover or focus-within, so
// a block at rest reads as text on paper. It renders AFTER <MarkdownField> in DOM order so it is
// never behind it even where the two happen to overlap.
import { untrack } from 'solid-js'
import type { ScratchBlock as ScratchBlockData } from '../../../core/src/scratchTypes'
import type { NoteCandidate } from '../editor/wikilink'
import MarkdownField from '../ui/MarkdownField'
import IconButton from '../ui/IconButton'
import styles from './ScratchBlock.module.css'

export type ScratchBlockProps = {
    block: ScratchBlockData
    rect: { left: number; top: number; w: number; scale: number }
    autofocus: boolean
    interactive: boolean
    onText: (text: string) => void
    /** Focus left the block (focusout with relatedTarget outside it). */
    onLeave: () => void
    onDelete: () => void
    /** Move handle drag: host-px pointer position on each move, and on release. The first call
     *  comes on the handle's pointerdown itself, so the caller can record the grab offset. */
    onDragMove: (hx: number, hy: number) => void
    onDragEnd: (hx: number, hy: number) => void
    class?: string
    /** Completion sources for MarkdownField's wikilink/tag autocomplete — pass-through to the
     *  field. Optional: the layer may not have them wired yet. */
    noteNames?: () => NoteCandidate[]
    tagNames?: () => string[]
    notePath?: string | null
}

function ScratchBlock(props: ScratchBlockProps) {
    let root!: HTMLDivElement
    let dragging = false

    /** Client px -> the host's px: the block is absolutely positioned inside the layer root, which
     *  is its offsetParent. */
    const toHost = (e: PointerEvent): [number, number] => {
        const host = root.offsetParent as HTMLElement | null
        const r = host?.getBoundingClientRect() ?? { left: 0, top: 0 }
        return [e.clientX - r.left, e.clientY - r.top]
    }

    const onHandleDown = (e: PointerEvent) => {
        if (e.button !== 0 || !props.interactive) return
        // No text selection, no focus change: the editor keeps its caret through a move.
        e.preventDefault()
        e.stopPropagation()
        try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
            /* a synthetic event has no live pointer to capture */
        }
        dragging = true
        props.onDragMove(...toHost(e))
    }
    const onHandleMove = (e: PointerEvent) => {
        if (!dragging) return
        props.onDragMove(...toHost(e))
    }
    const onHandleUp = (e: PointerEvent) => {
        if (!dragging) return
        dragging = false
        props.onDragEnd(...toHost(e))
    }

    return (
        <div
            ref={root}
            class={`${styles.block} ${props.class ?? ''}`}
            classList={{ [styles.interactive]: props.interactive }}
            data-scratch-block={props.block.id}
            data-testid="scratch-block"
            style={{
                left: `${props.rect.left}px`,
                top: `${props.rect.top}px`,
                width: `${props.rect.w}px`,
                '--scratch-scale': String(props.rect.scale),
            }}
            onFocusOut={e => {
                const to = e.relatedTarget
                if (to instanceof Node && root.contains(to)) return
                props.onLeave()
            }}
        >
            <MarkdownField
                value={untrack(() => props.block.text)}
                onInput={text => props.onText(text)}
                autofocus={untrack(() => props.autofocus)}
                class={styles.field}
                noteNames={props.noteNames}
                tagNames={props.tagNames}
                notePath={props.notePath}
            />
            {/* AFTER the field in DOM order + entirely above the block's own box (see .chrome): never
                behind CodeMirror's positioned `.cm-editor`, so a real click reaches these controls. */}
            <div class={styles.chrome} data-testid="scratch-chrome">
                <div
                    class={styles.handle}
                    role="button"
                    aria-label="Move note"
                    title="Move note"
                    data-testid="scratch-move"
                    onPointerDown={onHandleDown}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                />
                {/* The wrapper owns the reveal: ui.css pins an icon button's own opacity. */}
                <div class={styles.delete} data-testid="scratch-delete">
                    <IconButton
                        icon="X"
                        label="Delete note"
                        size="sm"
                        onClick={e => {
                            e.stopPropagation()
                            props.onDelete()
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

export default ScratchBlock
