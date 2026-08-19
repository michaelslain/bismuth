// app/src/PaneTree.tsx
// Recursively renders one tab's pane tree. A leaf renders PaneContent and reports
// focus/clicks; a split renders two children with a draggable divider between them.
//
// `PaneLeaf` used to be defined inline here; it is now promoted to `PaneLeaf.tsx` (with its header
// chrome split further into `PaneHeader.tsx` and its drop affordances into `PaneDropZone.tsx`) so
// each can be posed and gated on its own. `PaneTreeProps` moved with it — this file re-exports it
// so nothing importing `PaneTreeProps` from `./PaneTree` breaks.
import { Show, createSignal, onCleanup } from 'solid-js'
import type { PaneNode, Leaf } from './panes'
import { PaneLeaf, type PaneTreeProps } from './PaneLeaf'
import styles from './PaneTree.module.css'

export type { PaneTreeProps }

export function PaneTree(props: PaneTreeProps) {
    return (
        <Show
            when={
                props.node.kind === 'split'
                    ? (props.node as Extract<PaneNode, { kind: 'split' }>)
                    : null
            }
            fallback={<PaneLeaf {...props} node={props.node as Leaf} />}
        >
            {split => {
                let container!: HTMLDivElement
                // While dragging the divider, sizes must track the cursor exactly — suppress the
                // flex-basis transition (see .pane-split.resizing in App.css) for the duration.
                const [resizing, setResizing] = createSignal(false)
                // Teardown for an in-flight divider drag. Hoisted to the split-branch scope so
                // onCleanup can detach the window listeners if this node unmounts mid-drag
                // (e.g. an external bismuth-deleted/bismuth-moved/close event rewrites the tab tree before
                // pointerup fires), avoiding leaked listeners + setResizing on a disposed scope.
                let endDrag: (() => void) | null = null
                const startDrag = (e: PointerEvent) => {
                    e.preventDefault()
                    setResizing(true)
                    const rect = container.getBoundingClientRect()
                    const move = (ev: PointerEvent) => {
                        const ratio =
                            split().dir === 'row'
                                ? (ev.clientX - rect.left) / rect.width
                                : (ev.clientY - rect.top) / rect.height
                        props.onResize(
                            split().id,
                            Math.min(0.92, Math.max(0.08, ratio)),
                        )
                    }
                    // pointercancel (OS pointer takeover) must end the drag too, or the
                    // listeners leak and .pane-split stays stuck in its no-transition state.
                    const up = () => {
                        endDrag = null
                        setResizing(false)
                        window.removeEventListener('pointermove', move)
                        window.removeEventListener('pointerup', up)
                        window.removeEventListener('pointercancel', up)
                    }
                    endDrag = up
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', up)
                    window.addEventListener('pointercancel', up)
                }
                // If the split unmounts mid-drag, run the same teardown so the move/up listeners
                // are removed from window. setResizing is a no-op here (scope is disposing) but
                // the listener detachment is the point.
                onCleanup(() => endDrag?.())
                return (
                    <div
                        ref={container}
                        class={styles['pane-split']}
                        classList={{
                            [styles['row']]: split().dir === 'row',
                            [styles['col']]: split().dir === 'col',
                            [styles['resizing']]: resizing(),
                        }}
                    >
                        <div
                            class={styles['pane-child']}
                            style={{ 'flex-basis': `${split().ratio * 100}%` }}
                        >
                            <PaneTree {...props} node={split().a} />
                        </div>
                        <div
                            class={styles['pane-divider']}
                            classList={{
                                // `row` stays a BARE LITERAL: only `.pane-divider.col` has a rule.
                                // A name this module does not define resolves to `undefined` and
                                // lands class="undefined" on the element.
                                row: split().dir === 'row',
                                [styles['col']]: split().dir === 'col',
                            }}
                            onPointerDown={startDrag}
                        />
                        <div
                            class={styles['pane-child']}
                            style={{
                                'flex-basis': `${(1 - split().ratio) * 100}%`,
                            }}
                        >
                            <PaneTree {...props} node={split().b} />
                        </div>
                    </div>
                )
            }}
        </Show>
    )
}
