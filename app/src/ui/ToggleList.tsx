import type { Component, JSX } from 'solid-js'
import styles from './ToggleList.module.css'

export type ToggleListProps = { class?: string; children: JSX.Element }

/** Bordered, scrolling surface (max-height 320px) grouping a stack of ToggleRows. */
const ToggleList: Component<ToggleListProps> = props => (
    <div class={[styles.list, props.class ?? ''].filter(Boolean).join(' ')}>
        {props.children}
    </div>
)

export default ToggleList
