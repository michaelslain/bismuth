import { type Component, type JSX } from 'solid-js'
import styles from './SettingsSection.module.css'

export type SettingsSectionProps = {
    class?: string
    children: JSX.Element
}

/** The `── name ─────` section rule separating groups of fields (was `.set-sect`). */
const SettingsSection: Component<SettingsSectionProps> = props => (
    <div class={`${styles.sect} ${props.class ?? ''}`}>{props.children}</div>
)

export default SettingsSection
