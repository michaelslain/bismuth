import type { Component } from 'solid-js'
import BracketToggle, { type BracketToggleState } from './BracketToggle'
import styles from './TaskMark.module.css'

export type TaskMarkProps = {
    /** The task's box char: ` ` to do, `/` (or `\`) in progress, `x` (or `X`) done, `-` cancelled. */
    char: string
    class?: string
}

/** A task status as its typed bracket mark (`[ ]` `[/]` `[x]` `[-]`), display only: no click, no
 *  ARIA. The row or label around it owns the gesture. */
const TaskMark: Component<TaskMarkProps> = props => {
    const state = (): BracketToggleState | undefined =>
        props.char === '/' || props.char === '\\'
            ? 'doing'
            : props.char === '-'
              ? 'cancelled'
              : undefined
    return (
        <span
            class={`${styles.mark} ${props.char === '-' ? styles.cancelled : ''} ${props.class ?? ''}`}
        >
            <BracketToggle
                checked={props.char === 'x' || props.char === 'X'}
                state={state()}
            />
        </span>
    )
}

export default TaskMark
