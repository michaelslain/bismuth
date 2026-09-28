import { Show, type Component } from 'solid-js'
import Label from './Label'
import StatusDot, { groupColor } from './StatusDot'
import Text from './Text'
import styles from './GroupHeader.module.css'

export type GroupHeaderProps = {
    /** Shown uppercase via CSS, not transformed in JS. */
    label: string
    /** Renders ` // N` after the label when given. */
    count?: number
    /** CSS colour for the dot and the label. Default `groupColor(label)`. */
    color?: string
    /** The leading StatusDot. Default true. */
    dot?: boolean
    class?: string
}

/**
 * The `● LABEL // N` group header shared by List, Table, Cards and Bullets: a 6px StatusDot, the
 * label in micro uppercase with eyebrow tracking (both in the group colour), and the count in
 * muted ink. Padding is deliberately NOT here — the caller's row or band owns its own gutter.
 */
const GroupHeader: Component<GroupHeaderProps> = props => {
    const color = () => props.color ?? groupColor(props.label)
    return (
        <div
            class={[styles['group-header'], props.class].filter(Boolean).join(' ')}
            style={{ color: color() }}
        >
            <Show when={props.dot ?? true}>
                <StatusDot color={color()} />
            </Show>
            <Label class={styles['group-label']}>{props.label}</Label>
            <Show when={props.count !== undefined}>
                <Text as="span" size="inherit" tone="muted" weight="inherit">
                    // {props.count}
                </Text>
            </Show>
        </div>
    )
}

export default GroupHeader
