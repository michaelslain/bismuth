// app/src/bases/ReadonlyValue.tsx
// A value no editor here can round-trip (a list of numbers or links, a comma inside a value) or a
// column that is not writable (`file.folder`): shown as muted text, never committed, so opening
// it is harmless. Shared by PropertyValueEditor's `readonly` kind and CardEditModal's
// non-writable rows.
import type { Component } from 'solid-js'
import Text from '../ui/Text'
import { readonlyText } from './propertyEdit'

export type ReadonlyValueProps = {
    value: unknown
    /** Shown when the value is empty (CardEditModal passes an em dash). */
    placeholder?: string
    /** Merged onto the root so a caller can adjust one instance without forking this. */
    class?: string
}

const ReadonlyValue: Component<ReadonlyValueProps> = props => {
    const text = () => readonlyText(props.value) || (props.placeholder ?? '')
    return (
        <Text
            as="span"
            tone="muted"
            class={props.class}
            title="Not editable here — edit this property in the note"
        >
            {text()}
        </Text>
    )
}

export default ReadonlyValue
