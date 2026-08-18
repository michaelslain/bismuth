// app/src/PaneHeader.tsx
// The mini view-bar breadcrumb shown atop a pane when a tab's tree has more than one leaf —
// lifted out of PaneLeaf (PaneTree.tsx) so the header chrome can be posed and gated on its own.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE). `PaneHeader.tsx` will import the shared `PaneTree.module.css`
// once the CSS half lands (Task 12 folds `.pane-*` from App.css AND all of PaneTree.css into that
// one module, per Trap 4 — `.pane-leaf.focused .pane-header` crosses the PaneLeaf/PaneHeader
// boundary and needs one shared module to keep working).
//
// The `.pane-header-x` guard below is the imperative reference from PaneTree.tsx:112
// (`classList.contains("pane-header-x")`) — it decides whether a pointerdown on the header should
// start dragging the pane (drag) or fall through to the close button. It is carried over UNCHANGED
// as a bare literal in this extraction commit; converting it to `classList.contains(styles["pane-header-x"])`
// is CSS-half work (the class only needs converting once it is actually hashed).
import { Show } from 'solid-js'
import { Icon } from './icons/Icon'
import { IconButton } from './ui/IconButton'

export function PaneHeader(props: {
    icon?: string
    label: string
    onPointerDown: (e: PointerEvent) => void
    onClose: () => void
}) {
    return (
        <div
            class="pane-header"
            onPointerDown={e => {
                if (
                    (e.target as HTMLElement).classList.contains(
                        'pane-header-x',
                    )
                )
                    return
                props.onPointerDown(e)
            }}
        >
            <Show when={props.icon}>
                {icon => (
                    <Icon value={icon()} size={13} class="pane-header-icon" />
                )}
            </Show>
            <span class="pane-header-label">{props.label}</span>
            <IconButton
                icon="X"
                label="Close pane"
                class="pane-header-x"
                iconSize={12}
                onMouseDown={e => {
                    e.stopPropagation() // don't also trigger focus
                    e.preventDefault()
                    props.onClose()
                }}
            />
        </div>
    )
}
