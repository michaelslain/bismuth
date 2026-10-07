// app/src/bases/ReadonlyValue.tsx
// A value no editor here can round-trip (a list of numbers or links, a comma inside a value) or a
// column that is not writable (`file.folder`): shown as muted text, never committed, so opening
// it is harmless. Shared by PropertyValueEditor's `readonly` kind and CardEditModal's
// non-writable rows. An empty value is the app's one `ui/EmptyValue` — not a hand-typed dash.
import { Show, type Component } from 'solid-js'
import EmptyValue from '../ui/EmptyValue'
import Text from '../ui/Text'
import { readonlyText } from './propertyEdit'
import { isEmptyValue } from './valueDisplay'

export type ReadonlyValueProps = {
    value: unknown
    /** The glyph shown when the value is empty (defaults to the em dash). */
    placeholder?: string
    /** Merged onto the root so a caller can adjust one instance without forking this. */
    class?: string
}

const ReadonlyValue: Component<ReadonlyValueProps> = props => (
    <Show
        when={!isEmptyValue(props.value) && readonlyText(props.value) !== ''}
        fallback={
            <EmptyValue class={props.class}>{props.placeholder}</EmptyValue>
        }
    >
        <Text
            as="span"
            tone="muted"
            class={props.class}
            title="Not editable here — edit this property in the note"
        >
            {readonlyText(props.value)}
        </Text>
    </Show>
)

export default ReadonlyValue
