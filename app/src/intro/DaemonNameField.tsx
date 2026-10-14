// The intro's "Name your daemon" art: the daemon's own face (.:[00]:.) over the standard
// ui/TextInput, unstyled. The face listens while a name is typed. The name is saved when the vault opens
// (introEnterVault → firstRunHandoff → identity.md).
import type { Component } from 'solid-js'
import DaemonFace from '../daemon/DaemonFace'
import TextInput from '../ui/TextInput'
import { isConfirmKey } from '../ui/widgetKeys'
import styles from './DaemonNameField.module.css'

export type DaemonNameFieldProps = {
    value: string
    onInput: (value: string) => void
    /** Enter in the field: the intro pages on, as `next` would. */
    onSubmit?: () => void
    class?: string
}

const DaemonNameField: Component<DaemonNameFieldProps> = props => (
    <div class={[styles.root, props.class ?? ''].filter(Boolean).join(' ')}>
        <DaemonFace
            mood={props.value.trim() ? 'listening' : 'idle'}
            label={props.value.trim() || 'daemon'}
        />
        <div class={styles.field}>
            <TextInput
                value={props.value}
                onInput={props.onInput}
                placeholder="daemon"
                aria-label="daemon name"
                maxLength={40}
                spellcheck={false}
                autocomplete="off"
                onKeyDown={e => {
                    if (!isConfirmKey(e)) return
                    e.preventDefault()
                    props.onSubmit?.()
                }}
            />
        </div>
    </div>
)

export default DaemonNameField
