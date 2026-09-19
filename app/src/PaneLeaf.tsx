// app/src/PaneLeaf.tsx
// A single pane: renders its content, reports focus/right-click, and is a drop target for the
// pointer-events view-drag (tabs/panes/tree rows — dnd/viewDrag.ts; there is no separate HTML5
// file-drop path any more).
// Promoted out of PaneTree.tsx (where it was an internal, unexported function) unchanged, with its
// header chrome split into `PaneHeader.tsx` and its two drop affordances split into
// `PaneDropZone.tsx` — see those files for why.
//
// Class names are reached through this component's own colocated `PaneLeaf.module.css`. Focus
// state used to brighten PaneHeader via the class-based ancestor selector `.pane-leaf.focused
// .pane-header`, which required sharing one module across both components (CSS Modules hash per
// file, so a selector spanning two components' classes cannot resolve once they hash separately).
// Now this component sets a `data-pane-focused` RUNTIME HOOK (data-* attribute, never hashed) on
// its own root, and PaneHeader.module.css's rule reads `[data-pane-focused] .pane-header` — no
// class from this module involved, so each component keeps its own stylesheet.
import { Show, type Accessor } from 'solid-js'
import styles from './PaneLeaf.module.css'
import type { PaneNode, Leaf } from './panes'
import { PaneContent } from './PaneContent'
import { PaneHeader } from './PaneHeader'
import { PaneDropZone } from './PaneDropZone'
import { contentLabel, contentIcon } from './tabIds'
import type { DragState } from './dnd/viewDrag'
import { isChatReferenceDrop, isEditorReferenceDrop } from './dnd/noteRef'
import type { Zone } from './dnd/geometry'
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
    dragState: Accessor<DragState>
    onStartPaneDrag: (e: PointerEvent, leafId: string, label: string) => void
    onSaved: () => void
    onOpen: (path: string) => void
    onNewTerminal: (leafId: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    terminalLabel?: (content: string) => string
    /** The user-set tab name owning a content id — a chat pane's header title follows it. */
    chatTabName?: (content: string) => string | undefined
}

export function PaneLeaf(props: PaneTreeProps & { node: Leaf }) {
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

    // An editor-reference drop (Row 74c): the pointer-drag payload is a referenceable note/embed
    // and this pane hosts a live note editor, dropped in the (much larger) reference zone —
    // dropping inserts a `[[wikilink]]`/`![[embed]]` at the drop point, NOT a pane split. Same
    // shape as chatRefDrop above, and isEditorReferenceDrop is the SAME predicate App's drop
    // handler uses. `d.target.editor` is the one source of truth for "this pane has a live
    // CodeMirror view" — a base pane never claims the cue.
    const editorRefDrop = (): boolean => {
        const d = props.dragState()
        return (
            d.active &&
            d.target?.kind === 'pane' &&
            d.target.leafId === props.node.id &&
            isEditorReferenceDrop(
                props.node.content,
                d.descriptor,
                d.target.zone,
                d.target.editor,
            )
        )
    }

    // Drop-zone to highlight: a view drag (tab/pane) reports its live zone when this pane is the
    // current target. Suppressed entirely for a chat-reference or editor-reference drop — those
    // show the reference cue below, never a split zone.
    const activeZone = (): Zone | null => {
        if (chatRefDrop() || editorRefDrop()) return null
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
            class={styles['pane-leaf']}
            data-pane-leaf={props.node.id}
            // Runtime hook read by dnd/viewDrag.ts's resolveTarget, so it can decide the reference
            // geometry without reaching into App's model. An attribute, not a class: a module class
            // is hashed at build time, so a string-literal class selector would compile and match
            // nothing.
            data-pane-content={props.node.content}
            // Runtime hook read by PaneHeader.module.css's `[data-pane-focused] .pane-header`
            // rule, so the focus brightening can cross the file boundary without a shared module.
            data-pane-focused={
                props.node.id === props.focusId ? true : undefined
            }
            onMouseDown={() => props.onFocus(props.node.id)}
            onContextMenu={e => {
                e.preventDefault()
                props.onMenu(props.node.id, e.clientX, e.clientY)
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
                    tabName={() => props.chatTabName?.(props.node.content)}
                />
            </div>
            <Show when={activeZone()}>{z => <PaneDropZone zone={z()} />}</Show>
            {/* Reference drop cue (Row 74 + 74c): a full-pane affordance that reads "drop to
          reference" instead of the split-quadrant highlight — a chat-mention drop (any pane
          showing a chat) or an editor-reference drop (a note/embed over a live note editor) both
          mean "this drop won't split", so one cue covers both. */}
            <Show when={chatRefDrop() || editorRefDrop()}>
                <PaneDropZone reference={true} />
            </Show>
        </div>
    )
}
