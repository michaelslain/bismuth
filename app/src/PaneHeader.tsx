// app/src/PaneHeader.tsx
// The mini view-bar breadcrumb shown atop a pane when a tab's tree has more than one leaf —
// lifted out of PaneLeaf (PaneTree.tsx) so the header chrome can be posed and gated on its own.
//
// Class names are reached through this component's own colocated `PaneHeader.module.css`. The
// "focused" brightening used to be a class-based descendant selector (`.pane-leaf.focused
// .pane-header`) that forced this module to be shared with PaneLeaf — now it reads a
// `data-pane-focused` attribute PaneLeaf.tsx sets on its root instead (see PaneHeader.module.css),
// so each component owns its own stylesheet.
//
// The header's own `onPointerDown` starts a pane drag (see PaneLeaf's `onStartPaneDrag`). The
// close button used to guard against that by having the PARENT interrogate `e.target`'s class
// list for `"pane-header-x"` — a DOM-string check that would silently stop matching once the CSS
// half hashes that class. The close button now declares the pointerdown is its own by stopping it
// directly (`stopPropagation` on `onPointerDown`), so the header's own pointerdown handler never
// sees it. Note `stopPropagation` on `onClick`/`onMouseDown` would NOT have covered this — pointerdown
// is its own event and bubbles independently.
//
// The close button is `variant="unselected"` (ds-bridges Task 1) — a rest opacity of 0.5 that
// goes to full opacity + accent brackets on hover, with NO background fill (IconButton's own
// unselected/hover treatment). It used to carry a PaneHeader-local hover rule that painted
// `--state-hover-bg` behind it; that fill is gone at the user's request (no background fills on
// buttons) and the plain `variant="unselected"` state already gives the right rest/hover opacity,
// so the local override and its `pane-header-x` class are gone too.
import { Show } from 'solid-js'
import styles from './PaneHeader.module.css'
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
                variant="unselected"
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
