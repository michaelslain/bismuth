import type { Component } from 'solid-js'
import styles from './LogoMark.module.css'

export type LogoMarkProps = {
    /** Basename under /logos/, e.g. DEFAULTS.appearance.icon. */
    icon: string
    /** Square edge in px. */
    size: number
    /** Accessible name → alt. Omitted → alt="" (decorative). */
    label?: string
    class?: string
}

/** The shipped `/logos/<icon>.svg` mark in a square box of `size` px. */
const LogoMark: Component<LogoMarkProps> = props => {
    return (
        <div
            class={props.class ? `${styles.logomark} ${props.class}` : styles.logomark}
            style={{ width: `${props.size}px`, height: `${props.size}px` }}
        >
            <img
                src={`/logos/${props.icon}.svg`}
                width={props.size}
                height={props.size}
                alt={props.label ?? ''}
            />
        </div>
    )
}

export default LogoMark
