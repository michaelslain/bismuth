// app/src/PaneDropZone.tsx
// The two drop affordances a pane leaf can show mid-drag: the four-quadrant split highlight (a
// file/tab/pane drag over an edge) and the chat-reference cue (dropping a referenceable file over
// an open chat pane inserts a `[[mention]]` instead of splitting). Lifted out of PaneLeaf
// (PaneTree.tsx) unchanged — PaneLeaf still owns the two reactive predicates (`activeZone()`,
// `chatRefDrop()`) that decide WHETHER either renders at all (each still wrapped in its own
// `<Show>` at the call site, exactly as before); this component only decides WHICH of the two
// shapes to draw, via the discriminated `zone` | `reference` prop.
//
// `.pane-dropzone` + its five position variants (`left`/`right`/`up`/`down`/`center`) and
// `.pane-drop-reference`/`.pane-drop-reference-cue` live in this component's own colocated
// `PaneDropZone.module.css`, reached via index lookup (`class={`${styles["pane-dropzone"]}
// ${styles[props.zone]}`}` — a build-time CONSTANT per render for a given zone, so it stays a
// plain `class` rather than `classList`).
import { Show } from 'solid-js'
import styles from './PaneDropZone.module.css'
import { Icon } from './icons/Icon'
import Text from './ui/Text'
import type { Zone } from './dnd/geometry'

type PaneDropZoneProps =
    | { zone: Zone; reference?: undefined }
    | { zone?: undefined; reference: true }

export function PaneDropZone(props: PaneDropZoneProps) {
    return (
        <Show
            when={props.reference}
            fallback={
                <div
                    class={
                        // Guarded because the props union allows `zone` to be undefined in the
                        // reference variant, and TS cannot narrow it inside a JSX prop. The old
                        // template-string form accepted undefined silently and emitted a literal
                        // `class="pane-dropzone undefined"`; an index lookup surfaces it instead.
                        props.zone
                            ? `${styles['pane-dropzone']} ${styles[props.zone]}`
                            : styles['pane-dropzone']
                    }
                />
            }
        >
            <div class={styles['pane-drop-reference']}>
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['pane-drop-reference-cue']}
                >
                    <Icon value="AtSign" size={14} /> Drop to reference
                </Text>
            </div>
        </Show>
    )
}
