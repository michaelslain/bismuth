import { type Component, type JSX } from 'solid-js'
import styles from './SettingsHint.module.css'

export type SettingsHintProps = {
    class?: string
    children: JSX.Element
}

/** Micro faint helper text under a settings field. Usable standalone (was `.set-hint`). */
const SettingsHint: Component<SettingsHintProps> = props => (
    <div class={`${styles.hint} ${props.class ?? ''}`}>{props.children}</div>
)

export default SettingsHint
