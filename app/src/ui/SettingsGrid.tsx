import { type Component, type JSX } from 'solid-js'
import styles from './SettingsGrid.module.css'

export type SettingsGridProps = {
    class?: string
    children: JSX.Element
}

/** A vertical stack of SettingsField rows, each its own label-column grid keyed to `--label-col`
 *  so every row's control starts at the same x (was `.set-grid`). */
const SettingsGrid: Component<SettingsGridProps> = props => (
    <div class={`${styles.grid} ${props.class ?? ''}`}>{props.children}</div>
)

export default SettingsGrid
