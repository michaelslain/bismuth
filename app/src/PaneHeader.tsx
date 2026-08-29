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
// The header's own `onPointerDown` starts a pane drag (see PaneLeaf's `onStartPaneDrag`). The
// close button used to guard against that by having the PARENT interrogate `e.target`'s class
// list for `"pane-header-x"` — a DOM-string check that would silently stop matching once the CSS
// half hashes that class. The close button now declares the pointerdown is its own by stopping it
// directly (`stopPropagation` on `onPointerDown`), so the header's own pointerdown handler never
// sees it. Note `stopPropagation` on `onClick`/`onMouseDown` would NOT have covered this — pointerdown
// is its own event and bubbles independently.
import { Show } from 'solid-js'
import styles from './PaneTree.module.css'
import { Icon } from './icons/Icon'
import { IconButton } from './ui/IconButton'
import Label from './ui/Label'

export function PaneHeader(props: {
    icon?: string
    label: string
    onPointerDown: (e: PointerEvent) => void
    onClose: () => void
}) {
    return (
        <div class={styles['pane-header']} onPointerDown={props.onPointerDown}>
            <Show when={props.icon}>
                {icon => (
                    <Icon
                        value={icon()}
                        class={styles['pane-header-icon']}
                    />
                )}
            </Show>
            <Label fill class={styles['pane-header-label']}>
                {props.label}
            </Label>
            <IconButton
                icon="X"
                label="Close pane"
                class={styles['pane-header-x']}
                onPointerDown={e => e.stopPropagation()} // don't start a pane drag
                onMouseDown={e => {
                    e.stopPropagation() // don't also trigger focus
                    e.preventDefault()
                    props.onClose()
                }}
            />
        </div>
    )
}
