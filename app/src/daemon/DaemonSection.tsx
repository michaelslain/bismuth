// app/src/daemon/DaemonSection.tsx
// The shared frame for one right-column section on the daemon page (inbox / crons / services /
// log): a lowercase heading + optional count badge, an empty one-liner while the section has
// nothing to show, then the section's own rows as opaque children. `fill` (log only) takes the
// column's leftover height and scrolls its own body with the panel's familiar 16px bottom fade;
// every other section sizes to its content.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
import styles from './DaemonSection.module.css'

export type DaemonSectionProps = {
    /** 'inbox' | 'crons' | 'services' | 'log' — rendered lowercase as given. */
    title: string
    /** Omitted → no badge (log). */
    count?: number
    /** The faint one-liner shown under the heading while `isEmpty`. */
    empty: string
    isEmpty: boolean
    /** Take the leftover height; the body scrolls internally with a 16px bottom fade. Default false: size to content. */
    fill?: boolean
    /** Always rendered, after the empty line when `isEmpty`. */
    children?: JSX.Element
    class?: string
}

function DaemonSection(props: DaemonSectionProps) {
    return (
        <div
            class={`${styles.section} ${props.fill ? styles.fill : ''} ${props.class ?? ''}`}
            data-testid="daemon-section"
            data-section={props.title}
        >
            <div class={styles.heading}>
                <Text as="div" size="micro" tone="faint" eyebrow>
                    {props.title}
                </Text>
                <Show when={props.count !== undefined}>
                    <Badge class={styles.count}>{props.count}</Badge>
                </Show>
            </div>
            <Show when={props.isEmpty}>
                <Text as="div" size="ui" tone="faint" class={styles.empty}>
                    {props.empty}
                </Text>
            </Show>
            <div class={styles.body}>{props.children}</div>
        </div>
    )
}

export default DaemonSection
