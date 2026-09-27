// app/src/ui/DropCue.tsx — DropCue.tsx is the ONLY importer of DropCue.module.css.
// The "this surface will take the drop" affordance: an inset dashed accent ring plus a faint wash,
// laid over the nearest positioned ancestor while `active`. One primitive for every drop host (the
// chat pane, the daemon page) so the cue reads the same wherever a draggable lands.
import { Show, type Component } from 'solid-js'
import styles from './DropCue.module.css'

export type DropCueProps = {
    active: boolean
    className?: string
}

const DropCue: Component<DropCueProps> = props => (
    <Show when={props.active}>
        <div
            class={`${styles.cue} ${props.className ?? ''}`}
            aria-hidden="true"
        />
    </Show>
)

export default DropCue
