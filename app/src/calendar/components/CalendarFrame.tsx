// The calendar's root column (was `.calendar-app`). Every calendar view mounts inside one of
// these so the shared button look (borderless, muted, brighter on hover, a neutral highlight
// when a child VBtn's global `.active` is on) and the UI font apply once, at the top, instead
// of being re-declared per view. See CalendarFrame.module.css for why the old Obsidian-compat
// CSS variable block did not come with it.
import type { Component, JSX } from 'solid-js'
import styles from './CalendarFrame.module.css'

export type CalendarFrameProps = {
    class?: string
    children: JSX.Element
}

const CalendarFrame: Component<CalendarFrameProps> = props => {
    return (
        <div class={[styles.frame, props.class ?? ''].filter(Boolean).join(' ')}>
            {props.children}
        </div>
    )
}

export default CalendarFrame
