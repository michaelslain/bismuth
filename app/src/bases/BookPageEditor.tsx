import { createEffect, createSignal, For, Show, type Component } from 'solid-js'
import FilePicker from '../ui/FilePicker'
import RemoveRowButton from '../ui/RemoveRowButton'
import RowActions from '../ui/RowActions'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import type { Face } from './bookFaces'
import { isFileDrag } from './cardImageDrop'
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
    const [dragging, setDragging] = createSignal<number | null>(null)
    // Where a drop lands: before tile `at` (tiles.length = after the last).
    const [dropAt, setDropAt] = createSignal<number | null>(null)

    const slotOf = (e: DragEvent, i: number) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        return e.clientX - r.left < r.width / 2 ? i : i + 1
    }
    const onOver = (e: DragEvent, i: number) => {
        if (dragging() === null && !isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        setDropAt(slotOf(e, i))
    }
    const onDrop = (e: DragEvent, i: number) => {
        e.preventDefault()
        e.stopPropagation()
        const at = slotOf(e, i)
        const from = dragging()
        setDropAt(null)
        setDragging(null)
        if (from !== null) {
            // moving a tile out from before the slot shifts the slot back by one
            const to = at > from ? at - 1 : at
            if (to !== from) props.onMove(from, to)
            return
        }
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length) props.onAddFiles(at, files)
    }
    const onGridOver = (e: DragEvent) => {
        if (dragging() === null && !isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
    }
    const onGridDrop = (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const from = dragging()
        setDropAt(null)
        setDragging(null)
        if (from !== null) {
            if (from !== props.tiles.length - 1) props.onMove(from, props.tiles.length - 1)
            return
        }
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length) props.onAddFiles(props.tiles.length, files)
    }

    return (
        <div class={`${styles.editor} ${props.className ?? ''}`} data-book-page-editor>
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
            <div class={styles.grid} onDragOver={onGridOver} onDrop={onGridDrop}>
                <For each={props.tiles}>
                    {(tile, i) => (
                        <div
                            class={styles.tile}
                            data-book-edit-tile={i()}
                            data-dragging={dragging() === i() ? '' : undefined}
                            data-drop={dropAt() === i() ? 'before' : dropAt() === i() + 1 && i() === props.tiles.length - 1 ? 'after' : undefined}
                            draggable={!held()}
                            onDragStart={e => {
                                setDragging(i())
                                e.dataTransfer?.setData('text/plain', tile.key)
                                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => {
                                setDragging(null)
                                setDropAt(null)
                            }}
                            onDragOver={e => onOver(e, i())}
                            onDrop={e => onDrop(e, i())}
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
                            <Text as="div" size="micro" tone="faint" class={styles.caption}>
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
        </div>
    )
}

export default BookPageEditor
