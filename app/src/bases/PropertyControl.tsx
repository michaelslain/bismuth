// app/src/bases/PropertyControl.tsx
// The control for ONE property row in CardEditModal (and any form that lists a row's
// properties), dispatched by what the property is:
//   • not writable → ReadonlyValue (a muted line; `file.folder`, formulas);
//   • boolean      → the read-only BooleanValue glyph inside a toggle button, so the control has the
//                    shape of the value it edits;
//   • markdown     → the host's own rich surface (`markdown`), since the drafts, drop zone and
//                    flush-on-close belong to the modal; falls back to the plain textarea;
//   • else         → the shared PropertyValueEditor (text/number/date/select/multiselect).
// The kind is read once by the caller, so a commit's optimistic row change never rebuilds this.
import { Match, Switch, type Component, type JSX } from 'solid-js'
import BooleanValue from './BooleanValue'
import PlainButton from '../ui/PlainButton'
import { PropertyValueEditor } from './PropertyValueEditor'
import ReadonlyValue from './ReadonlyValue'
import type { PropertyEditKind } from './propertyEdit'
import styles from './PropertyControl.module.css'

export type PropertyControlProps = {
    kind: PropertyEditKind
    value: unknown
    writable: boolean
    onCommit: (value: unknown) => void
    /** The host's rich editor for a `markdown` kind, built once. Absent → a plain textarea. */
    markdown?: () => JSX.Element
    /** Shown in place of an empty read-only value. */
    emptyText?: string
}

const PropertyControl: Component<PropertyControlProps> = props => {
    const flipped = () => !(props.value === true)
    return (
        <Switch
            fallback={
                <PropertyValueEditor
                    kind={props.kind}
                    value={props.value}
                    autofocus={false}
                    onCommit={props.onCommit}
                    onCancel={() => {}}
                />
            }
        >
            <Match when={!props.writable}>
                <ReadonlyValue value={props.value} placeholder={props.emptyText} />
            </Match>
            <Match when={props.kind.kind === 'boolean'}>
                <PlainButton
                    class={styles.toggle}
                    aria-pressed={props.value === true}
                    onClick={() => props.onCommit(flipped())}
                >
                    <BooleanValue value={props.value === true} />
                </PlainButton>
            </Match>
            <Match when={props.kind.kind === 'markdown' && props.markdown}>
                {render => render()()}
            </Match>
        </Switch>
    )
}

export default PropertyControl
