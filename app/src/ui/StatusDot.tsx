// app/src/ui/StatusDot.tsx
// Colored-dot + word status (no pill): the canonical status renderer. The category
// palette (Reading/Doing=teal / To Read/Todo=blue / Finished=green / Abandoned=rose) lives here
// so Table/List/Kanban — and any future status display — stay in sync.
//
// THE dot. Every coloured dot in the app composes this one — the inbox indicator (xs), a list row
// (sm), a kanban column header (md), a chat tab's colour submenu (lg + ring), a daemon row (glow)
// — so no caller sets a dot's size, ring or glow in its own CSS.
import type { Component } from 'solid-js'
import styles from './StatusDot.module.css'

export const STATUS_COLOR: Record<string, string> = {
    reading: 'var(--teal)',
    'to read': 'var(--blue)',
    toread: 'var(--blue)',
    finished: 'var(--green)',
    done: 'var(--green)',
    complete: 'var(--green)',
    abandoned: 'var(--rose)',
    dropped: 'var(--rose)',
    // Task-style statuses: the same two hues as their reading-list twins (todo = not started =
    // blue like "to read"; doing / in progress = underway = teal like "reading").
    todo: 'var(--blue)',
    doing: 'var(--teal)',
    'in progress': 'var(--teal)',
}

/** Resolve a status string to its category color (faint fallback). Exported for reuse. */
export function statusColor(s: string): string {
    return STATUS_COLOR[s.trim().toLowerCase()] ?? 'var(--faint)'
}

/** Resolve a status string to its category color for group/column headers (accent fallback). */
export function groupColor(key: string): string {
    return STATUS_COLOR[key.trim().toLowerCase()] ?? 'var(--accent)'
}

export type StatusDotProps = {
    /** xs 5px (an inline alert), sm 6px (default), md 8px (a column header), lg 10px (a picker). */
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** An inset hairline round the dot, so a dark fill still reads on a dark ground. A hollow dot
     *  (`color="transparent"`) gets the stronger ring: that ring IS the dot (a "none" choice). */
    ring?: boolean
    /** The accent halo — a live / running signal. */
    glow?: boolean
    /** Looked up in STATUS_COLOR (faint for an unknown string). */
    status?: string
    /** An explicit colour; wins over `status`. */
    color?: string
}

/** Just the dot, in a status's colour or an explicit one. */
const StatusDot: Component<StatusDotProps> = props => {
    const fill = () =>
        props.color ?? (props.status ? statusColor(props.status) : 'var(--faint)')
    return (
        <span
            class={styles['status-dot']}
            data-size={props.size ?? 'sm'}
            data-ring={props.ring ? '' : undefined}
            data-glow={props.glow ? '' : undefined}
            data-hollow={fill() === 'transparent' ? '' : undefined}
            style={{ background: fill() }}
        />
    )
}

export default StatusDot

/** Dot + label, both tinted to the status color. */
export const StatusText: Component<{ status: string }> = props => {
    return (
        <span class={styles['status-text']} style={{ color: statusColor(props.status) }}>
            <span class={styles['status-dot']} data-size="sm" />
            {props.status}
        </span>
    )
}
