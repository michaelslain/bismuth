import { Show, type Component } from 'solid-js'
import { formatDateField } from '../../../core/src/taskFields'
import Text from '../ui/Text'
import { PRIORITY_MARK } from './taskDisplay'
import styles from './TaskFieldChips.module.css'

export type TaskFieldChipsProps = {
    /** A task priority; `none` and unset render nothing. */
    priority?: string
    start?: string
    scheduled?: string
    due?: string
    recurrence?: string
    /** Paints the due chip in the danger colour. */
    overdue?: boolean
    /** Merged onto every chip so one caller can adjust them without forking this. */
    class?: string
}

/**
 * The parsed signifiers of a task, as plain muted inline text: priority mark, start, scheduled,
 * due and recurrence. Each renders only when its field is present. A fragment of inline spans, so
 * the parent decides where they flow (TaskRow puts them right after the description).
 */
const TaskFieldChips: Component<TaskFieldChipsProps> = props => {
    const cls = (extra = '') =>
        `${styles.field} ${extra} ${props.class ?? ''}`
    return (
        <>
            <Show when={props.priority && props.priority !== 'none'}>
                <Text
                    as="span"
                    inherit
                    class={cls()}
                    title={`${props.priority} priority`}
                >
                    {PRIORITY_MARK[props.priority!]}
                </Text>
            </Show>
            <Show when={props.start}>
                <Text as="span" inherit class={cls()}>
                    {formatDateField('start', props.start!)}
                </Text>
            </Show>
            <Show when={props.scheduled}>
                <Text as="span" inherit class={cls()}>
                    {formatDateField('scheduled', props.scheduled!)}
                </Text>
            </Show>
            <Show when={props.due}>
                <Text
                    as="span"
                    inherit
                    class={cls(props.overdue ? styles.overdue : '')}
                >
                    {formatDateField('due', props.due!)}
                </Text>
            </Show>
            <Show when={props.recurrence}>
                <Text as="span" inherit class={cls()}>
                    [{props.recurrence}]
                </Text>
            </Show>
        </>
    )
}

export default TaskFieldChips
