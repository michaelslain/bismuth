// app/src/ui/PathField.tsx
// A path input with a "browse" button beside it: type a path, or pick one from the native file
// dialog. ExportView wrote this twice, row for row (an input path and an output folder); it is the
// shape any "choose a file or folder" row takes. The picking itself is the caller's — this owns
// the row (input stretches, button sits at its natural width) and the commit gesture.
//
// `onCommit` fires on Enter and on blur, for a path that drives something (a preview) and so
// should be applied when the user is DONE typing rather than on every keystroke. Leave it off for
// a field that is only read later, on submit.
import type { Component } from 'solid-js'
import { IconTextButton } from './IconTextButton'
import { TextInput } from './TextInput'
import styles from './PathField.module.css'

export type PathFieldProps = {
    value: string
    onInput: (value: string) => void
    /** Apply the typed path — Enter, or leaving the field. */
    onCommit?: () => void
    /** Open the picker. The caller resolves the chosen path and feeds it back through `value`. */
    onBrowse: () => void
    placeholder?: string
    /** The button's text; defaults to `browse`. */
    browseLabel?: string
    /** The input's accessible name — there is no visible caption inside this row. */
    label?: string
    class?: string
}

const PathField: Component<PathFieldProps> = props => (
    <div class={`${styles['path-field']} ${props.class ?? ''}`}>
        <TextInput
            class={styles['path-input']}
            value={props.value}
            onInput={props.onInput}
            onBlur={() => props.onCommit?.()}
            onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && props.onCommit) {
                    e.preventDefault()
                    props.onCommit()
                }
            }}
            placeholder={props.placeholder}
            aria-label={props.label}
            spellcheck={false}
        />
        <IconTextButton icon="FolderOpen" onClick={() => props.onBrowse()}>
            {props.browseLabel ?? 'browse'}
        </IconTextButton>
    </div>
)

export default PathField
