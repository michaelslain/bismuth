import { type Component, type JSX } from 'solid-js'
import styles from './SettingsGrid.module.css'

export type SettingsGridProps = {
    class?: string
    children: JSX.Element
}

/** Two equal columns of settings fields (was `.set-grid`). */
const SettingsGrid: Component<SettingsGridProps> = props => (
    <div class={`${styles.grid} ${props.class ?? ''}`}>{props.children}</div>
)

export default SettingsGrid
