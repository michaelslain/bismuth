// app/src/PaneLeaf.tsx
// A single pane: renders its content, reports focus/right-click, accepts a file dragged from the
// tree (HTML5 drag → split), and is a drop target for the pointer-events view-drag (tabs/panes).
// Promoted out of PaneTree.tsx (where it was an internal, unexported function) unchanged, with its
// header chrome split into `PaneHeader.tsx` and its two drop affordances split into
// `PaneDropZone.tsx` — see those files for why.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only. `PaneLeaf.tsx` will import the shared `PaneTree.module.css` once the CSS half lands (Task
// 12 folds `.pane-*` from App.css AND all of PaneTree.css into that one module — Trap 4:
// `.pane-leaf.focused .pane-header` crosses into PaneHeader.tsx and needs the shared module).
import { Show, createSignal, type Accessor } from 'solid-js'
import styles from './PaneTree.module.css'
import type { PaneNode, Leaf, Dir } from './panes'
import { PaneContent } from './PaneContent'
import { PaneHeader } from './PaneHeader'
import { PaneDropZone } from './PaneDropZone'
import { contentLabel, contentIcon } from './tabIds'
import type { DragState } from './dnd/viewDrag'
import { isChatReferenceDrop } from './dnd/noteRef'
import { nearestEdge, type Zone } from './dnd/geometry'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'

export type PaneTreeProps = {
    node: PaneNode
    focusId: string
    showHeader: boolean // tab is split → show a name header on each pane
    onFocus: (leafId: string) => void
    onResize: (splitId: string, ratio: number) => void
    onMenu: (leafId: string, x: number, y: number) => void
    onClose: (leafId: string) => void
    onDropFile: (leafId: string, path: string, dir: Dir) => void
    dragState: Accessor<DragState>
    onStartPaneDrag: (e: PointerEvent, leafId: string, label: string) => void
    onSaved: () => void
    onOpen: (path: string) => void
    onNewTerminal: (leafId: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    terminalLabel?: (content: string) => string
}

const DRAG_MIME = 'application/x-bismuth-path' // a file dragged from the tree

export function PaneLeaf(props: PaneTreeProps & { node: Leaf }) {
    const [fileDropDir, setFileDropDir] = createSignal<Dir | null>(null)
    let el!: HTMLDivElement

    // Which half of the pane the cursor is over → which direction a file drop splits.
    // File drops always split (never replace), so this uses the edge-only helper.
    const getDropDir = (e: DragEvent): Dir => {
        const r = el.getBoundingClientRect()
        return nearestEdge(
            { x: r.left, y: r.top, w: r.width, h: r.height },
            e.clientX,
            e.clientY,
        )
    }

    // A chat-reference drop (Row 74): the pointer-drag payload is a referenceable file/folder and this
    // pane shows a chat — dropping inserts a `[[mention]]` into the composer, NOT a pane split. So we
    // suppress the four-quadrant split highlight and show a single "drop to reference" cue instead.
    // isChatReferenceDrop is the SAME predicate App's drop handler uses, so the cue can't disagree with
    // what the drop actually does.
    const chatRefDrop = (): boolean => {
        const d = props.dragState()
        return (
            d.active &&
            d.target?.kind === 'pane' &&
            d.target.leafId === props.node.id &&
            isChatReferenceDrop(props.node.content, d.descriptor)
        )
    }

    // Drop-zone to highlight: a file drag (HTML5) reports an edge; a view drag
    // (tab/pane) reports its live zone when this pane is the current target. Suppressed entirely for a
    // chat-reference drop — that shows the reference cue below, never a split zone.
    const activeZone = (): Zone | null => {
        if (chatRefDrop()) return null
        const fd = fileDropDir()
        if (fd) return fd
        const d = props.dragState()
        if (
            d.active &&
            d.target?.kind === 'pane' &&
            d.target.leafId === props.node.id
        ) {
            return d.target.zone
        }
        return null
    }

    return (
        <div
            ref={el}
            class={styles['pane-leaf']}
            classList={{
                [styles['focused']]: props.node.id === props.focusId,
            }}
            data-pane-leaf={props.node.id}
            onMouseDown={() => props.onFocus(props.node.id)}
            onContextMenu={e => {
                e.preventDefault()
                props.onMenu(props.node.id, e.clientX, e.clientY)
            }}
            onDragOver={e => {
                const types = e.dataTransfer?.types
                if (!types || !types.includes(DRAG_MIME)) return // only file-tree drags
                e.preventDefault() // allow drop
                setFileDropDir(getDropDir(e))
            }}
            onDragLeave={() => setFileDropDir(null)}
            onDrop={e => {
                const dir = fileDropDir()
                setFileDropDir(null)
                if (!dir) return
                const path = e.dataTransfer?.getData(DRAG_MIME)
                if (path) {
                    e.preventDefault()
                    props.onDropFile(props.node.id, path, dir)
                }
            }}
        >
            <Show when={props.showHeader}>
                <PaneHeader
                    icon={contentIcon(props.node.content)}
                    label={
                        props.terminalLabel?.(props.node.content) ??
                        contentLabel(props.node.content)
                    }
                    onPointerDown={e =>
                        props.onStartPaneDrag(
                            e,
                            props.node.id,
                            props.terminalLabel?.(props.node.content) ??
                                contentLabel(props.node.content),
                        )
                    }
                    onClose={() => props.onClose(props.node.id)}
                />
            </Show>
            <div class={styles['pane-body']}>
                <PaneContent
                    path={props.node.content}
                    onSaved={props.onSaved}
                    onOpen={props.onOpen}
                    onNewTerminal={() => props.onNewTerminal(props.node.id)}
                    noteNames={props.noteNames}
                    memoryNames={props.memoryNames}
                    tagNames={props.tagNames}
                />
            </div>
            <Show when={activeZone()}>{z => <PaneDropZone zone={z()} />}</Show>
            {/* Chat-reference drop cue (Row 74): a full-pane affordance that reads "drop to reference"
          instead of the split-quadrant highlight, so dragging a file over a chat clearly means a
          mention, not a pane split. */}
            <Show when={chatRefDrop()}>
                <PaneDropZone reference={true} />
            </Show>
        </div>
    )
}
