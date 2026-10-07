import { Show, type Component } from 'solid-js'
import Label from './Label'
import StatusDot, { STATUS_COLOR } from './StatusDot'
import Text from './Text'
import styles from './GroupHeader.module.css'

export type GroupHeaderProps = {
    /** Shown exactly as written — no case transform anywhere. */
    label: string
    /** Renders ` // N` after the label when given. */
    count?: number
    /** CSS colour for the dot and the label. Default: the status colour for a known label
     *  (reading / to read / finished / abandoned …), else neutral `--text-muted`. An unknown
     *  group does NOT borrow the accent — two unrelated groups would otherwise share one teal and
     *  read as the same group. */
    color?: string
    /** The leading StatusDot. Default true. When false its 6px slot is still reserved, so a
     *  dotless header's label lines up with a dotted one's. */
    dot?: boolean
    class?: string
}

/**
 * The `● label // N` group header shared by List, Table, Cards and Bullets: a 6px StatusDot, the
 * label in micro type with eyebrow tracking (both in the group colour), and the count in
 * muted ink. Padding is deliberately NOT here — the caller's row or band owns its own gutter.
 */
const GroupHeader: Component<GroupHeaderProps> = props => {
    const color = () =>
        props.color ?? STATUS_COLOR[props.label.trim().toLowerCase()] ?? 'var(--text-muted)'
    return (
        <div
            class={[styles['group-header'], props.class].filter(Boolean).join(' ')}
            style={{ color: color() }}
        >
            <Show
                when={props.dot ?? true}
                fallback={<span class={styles['group-dot-slot']} aria-hidden="true" />}
            >
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
