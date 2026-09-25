// The calendar's root column (was `.calendar-app`). Every calendar view mounts inside one of
// these so the UI font applies once, at the top, instead of being re-declared per view. It no
// longer restyles buttons by tag (one-button Task 2) — every button in the calendar is a
// Button-family component (TextButton/IconButton/IconTextButton) that carries its own bracket
// look and selected/unselected state, so there is nothing left for the frame to add. See
// CalendarFrame.module.css for why the old Obsidian-compat CSS variable block did not come with it.
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
