import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import FilePicker from '../ui/FilePicker'
import RemoveRowButton from '../ui/RemoveRowButton'
import RowActions from '../ui/RowActions'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import type { Face } from './bookFaces'
import { isFileDrag } from './cardImageDrop'
import { edgeScrollStep, ghostLabel, moveTarget, pastThreshold, slotForTile } from './pageSortDrag'
import { isDismissKey } from '../ui/widgetKeys'
import { DragGhost } from '../shell/DragGhost'
import { pointInDropRect, type NativeDragDetail } from '../nativeDrop'
import { claimNativeDrop } from '../nativeDropRouting'

/** The drag ghost sits this far below and right of the cursor, so the drop cue under it stays visible. */
const GHOST_OFFSET = 12
const GHOST_WIDTH = 160
import styles from './BookPageEditor.module.css'

/** One page in the sorter: its thumbnail (absent for a page not saved yet) and its caption. */
export type EditTile = {
    key: string
    label: string
    /** A page added since the sorter opened: shown by name until it is saved. */
    pending?: boolean
    face?: () => Promise<Face | undefined>
}

export type BookPageEditorProps = {
    tiles: EditTile[]
    /** Thumbnails drawn as the dark reader draws its pages. */
    shade?: (f: Face | undefined) => Face | undefined
    /** Offer `+ blank page` (a PDF can hold one; a book base cannot). */
    canBlank?: boolean
    /** Offer `merge a new version` (a PDF read on its own). */
    canMerge?: boolean
    /** The head's line, in place of `drag a page to move it` (a merge's summary). */
    note?: string
    /** Something changed since the sorter opened. */
    dirty: boolean
    /** A save is running: the controls wait. */
    busy?: boolean
    /** Something else is running (a merge being compared): the controls wait, the save keeps its label. */
    waiting?: boolean
    onMove: (from: number, to: number) => void
    onRemove: (index: number) => void
    /** Files dropped before tile `at` (`at` = tiles.length appends). */
    onAddFiles: (at: number, files: File[]) => void
    /** OS files dropped in the desktop app (Tauri's native drop, which carries paths, not files),
     *  before tile `at`. Absent: the sorter ignores native drops. */
    onDropPaths?: (at: number, paths: string[]) => void
    onAddBlank?: (at: number) => void
    /** A newer version of the PDF was picked to merge in. */
    onMerge?: (file: File) => void
    /** A merge is laid out: `undo merge` takes the place of `merge a new version` and puts the pages
     *  back as they were before it. */
    onUndoMerge?: () => void
    onSave: () => void
    onCancel: () => void
    className?: string
}

const Thumb: Component<{ tile: EditTile; shade?: BookPageEditorProps['shade'] }> = props => {
    let canvas: HTMLCanvasElement | undefined
    const [face, setFace] = createSignal<Face | undefined>()
    createEffect(() => {
        const load = props.tile.face
        if (load) void load().then(f => setFace(() => f))
    })
    createEffect(() => {
        const f = props.shade ? props.shade(face()) : face()
        if (!canvas || f?.kind !== 'ready') return
        const src = f.source as { width: number; height: number }
        canvas.width = src.width
        canvas.height = src.height
        canvas.getContext('2d')!.drawImage(f.source, 0, 0)
    })
    return (
        <Show
            when={face()?.kind === 'ready'}
            fallback={
                <div class={styles.blank}>
                    <Text size="micro" tone="faint">
                        {props.tile.pending ? 'new' : face()?.kind === 'missing' ? 'missing' : ''}
                    </Text>
                </div>
            }
        >
            <canvas ref={canvas} class={styles.canvas} />
        </Show>
    )
}

/** The book's pages as a grid to rearrange: drag a page to move it, the hover `[x]` removes it,
 *  the `[+]` tile after the last page adds images and PDFs at the end (or drop them between pages),
 *  and nothing is written until `save`. */
const BookPageEditor: Component<BookPageEditorProps> = props => {
    let picker: HTMLInputElement | undefined
    let mergePicker: HTMLInputElement | undefined
    const held = () => !!(props.busy || props.waiting)
    // The page being dragged (pointer events: HTML5 drag-and-drop never reaches the app's WKWebView).
    const [dragging, setDragging] = createSignal<number | null>(null)
    // Where a drop lands: before tile `at` (tiles.length = after the last).
    const [dropAt, setDropAt] = createSignal<number | null>(null)
    const [ghost, setGhost] = createSignal<{ x: number; y: number; label: string } | null>(null)
    let grid: HTMLDivElement | undefined
    let press: { from: number; x: number; y: number; id: number } | null = null
    let pointer = { x: 0, y: 0 }
    let scrollFrame = 0

    const slotAt = (x: number, y: number): number | null => {
        const el = document.elementFromPoint(x, y)
        if (!el || !grid?.contains(el)) return null
        if (el.closest('[data-book-edit-add]')) return props.tiles.length
        const tile = el.closest<HTMLElement>('[data-book-edit-tile]')
        if (!tile) return dropAt()
        const r = tile.getBoundingClientRect()
        return slotForTile(r.left, r.width, x, Number(tile.dataset.bookEditTile))
    }
    const track = () => {
        const g = grid
        if (dragging() === null || !g) return
        const r = g.getBoundingClientRect()
        const step = edgeScrollStep(r.top, r.bottom, pointer.y)
        if (step) {
            g.scrollTop += step
            setDropAt(slotAt(pointer.x, pointer.y))
        }
        scrollFrame = requestAnimationFrame(track)
    }
    const stop = () => {
        press = null
        cancelAnimationFrame(scrollFrame)
        setDragging(null)
        setDropAt(null)
        setGhost(null)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', stop)
        window.removeEventListener('keydown', onKey, true)
    }
    const onPointerMove = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        pointer = { x: e.clientX, y: e.clientY }
        if (dragging() === null) {
            if (!pastThreshold(e.clientX - press.x, e.clientY - press.y)) return
            setDragging(press.from)
            scrollFrame = requestAnimationFrame(track)
        }
        e.preventDefault()
        setGhost({ x: e.clientX, y: e.clientY, label: ghostLabel(props.tiles[press.from]?.label ?? '') })
        setDropAt(slotAt(e.clientX, e.clientY))
    }
    const onUp = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        const from = dragging()
        const at = from === null ? null : slotAt(e.clientX, e.clientY)
        stop()
        if (from === null || at === null) return
        const to = moveTarget(from, at)
        if (to !== from) props.onMove(from, to)
    }
    const onKey = (e: KeyboardEvent) => {
        if (!isDismissKey(e) || dragging() === null) return
        e.preventDefault()
        e.stopPropagation()
        stop()
    }
    const onPress = (e: PointerEvent, i: number) => {
        // the page's own [x] is a button: a press there removes, never lifts
        if (e.button !== 0 || held() || (e.target as Element).closest('button')) return
        press = { from: i, x: e.clientX, y: e.clientY, id: e.pointerId }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', stop)
        window.addEventListener('keydown', onKey, true)
    }
    onCleanup(stop)

    // Files dragged in from Finder in the desktop app: Tauri's native drop replaces the HTML5 one and
    // arrives as a window event carrying paths and the pointer in page CSS px.
    let root: HTMLDivElement | undefined
    onMount(() => {
        const onNative = (e: Event) => {
            const d = (e as CustomEvent<NativeDragDetail>).detail
            if (!props.onDropPaths || !root) return
            const inside = pointInDropRect(root.getBoundingClientRect(), d.x, d.y)
            if (d.type === 'leave' || !inside) return setDropAt(null)
            if (d.type === 'enter' || d.type === 'over') return setDropAt(held() ? null : (slotAt(d.x, d.y) ?? props.tiles.length))
            if (d.type !== 'drop' || d.paths.length === 0 || held()) return
            const at = slotAt(d.x, d.y) ?? props.tiles.length
            setDropAt(null)
            if (!claimNativeDrop(d)) return
            props.onDropPaths(at, d.paths)
        }
        window.addEventListener('bismuth-native-drag', onNative)
        onCleanup(() => window.removeEventListener('bismuth-native-drag', onNative))
    })

    // Files dragged in from outside (the browser build; the app's native drop never fires these).
    const fileSlot = (e: DragEvent, i: number) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        return slotForTile(r.left, r.width, e.clientX, i)
    }
    const onFileOver = (e: DragEvent, i: number) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        setDropAt(fileSlot(e, i))
    }
    const onFileDrop = (e: DragEvent, i: number) => {
        e.preventDefault()
        e.stopPropagation()
        const at = fileSlot(e, i)
        setDropAt(null)
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length) props.onAddFiles(at, files)
    }
    const onGridOver = (e: DragEvent) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
    }
    const onGridDrop = (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDropAt(null)
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length) props.onAddFiles(props.tiles.length, files)
    }

    return (
        <div ref={root} class={`${styles.editor} ${props.className ?? ''}`} data-book-page-editor>
            <div class={styles.head}>
                <Text tone="muted">{props.note ?? 'drag a page to move it'}</Text>
                <div class={styles.actions}>
                    <Show when={props.onUndoMerge}>
                        <TextButton disabled={held()} title="put the pages back as they were before the merge" onClick={() => props.onUndoMerge?.()}>
                            undo merge
                        </TextButton>
                    </Show>
                    <Show when={props.canMerge && !props.onUndoMerge}>
                        <TextButton
                            disabled={held() || props.dirty}
                            title={props.dirty ? 'save or cancel these changes first' : 'add new pages and replace changed ones from a newer copy of this pdf'}
                            onClick={() => mergePicker?.click()}
                        >
                            merge a new version
                        </TextButton>
                    </Show>
                    <Show when={props.canBlank}>
                        <TextButton disabled={held()} onClick={() => props.onAddBlank?.(props.tiles.length)}>
                            + blank page
                        </TextButton>
                    </Show>
                    <TextButton disabled={held()} onClick={() => props.onCancel()}>
                        cancel
                    </TextButton>
                    <TextButton primary disabled={held() || !props.dirty} onClick={() => props.onSave()}>
                        {props.busy ? 'saving' : 'save'}
                    </TextButton>
                </div>
            </div>
            <FilePicker
                ref={el => (picker = el)}
                accept="image/*,application/pdf"
                multiple
                onPick={files => props.onAddFiles(props.tiles.length, Array.from(files))}
            />
            <FilePicker
                ref={el => (mergePicker = el)}
                accept="application/pdf,.pdf"
                onPick={files => {
                    const f = files[0]
                    if (f) props.onMerge?.(f)
                }}
            />
            <div ref={grid} class={styles.grid} data-dragging={dragging() !== null ? '' : undefined} onDragOver={onGridOver} onDrop={onGridDrop}>
                <For each={props.tiles}>
                    {(tile, i) => (
                        <div
                            class={styles.tile}
                            data-book-edit-tile={i()}
                            data-dragging={dragging() === i() ? '' : undefined}
                            data-drop={dropAt() === i() ? 'before' : dropAt() === i() + 1 && i() === props.tiles.length - 1 ? 'after' : undefined}
                            onPointerDown={e => onPress(e, i())}
                            onDragOver={e => onFileOver(e, i())}
                            onDrop={e => onFileDrop(e, i())}
                        >
                            <div class={styles.sheet} data-row-actions-host>
                                <Thumb tile={tile} shade={props.shade} />
                                <RowActions class={styles.remove}>
                                    <RemoveRowButton
                                        label="remove page"
                                        disabled={held()}
                                        onClick={() => props.onRemove(i())}
                                    />
                                </RowActions>
                            </div>
                            <Text as="div" size="micro" tone="faint" class={styles.caption} data-testid="page-caption">
                                {tile.label}
                            </Text>
                        </div>
                    )}
                </For>
                {/* the last "page" adds pages: a click picks images and PDFs, a drop adds what was dropped */}
                <div
                    class={styles.tile}
                    data-book-edit-add
                    data-drop={dropAt() === props.tiles.length && props.tiles.length === 0 ? 'before' : undefined}
                >
                    <div class={`${styles.sheet} ${styles.add}`}>
                        <TextButton disabled={held()} aria-label="add pages" title="add images or PDFs" onClick={() => picker?.click()}>
                            +
                        </TextButton>
                    </div>
                    <Text as="div" size="micro" tone="faint" class={styles.caption}>
                        add pages
                    </Text>
                </div>
            </div>
            <Show when={ghost()}>
                {g => (
                    <Portal>
                        <DragGhost label={g().label} pane={false} x={g().x + GHOST_OFFSET} y={g().y + GHOST_OFFSET} width={GHOST_WIDTH} />
                    </Portal>
                )}
            </Show>
        </div>
    )
}

export default BookPageEditor
