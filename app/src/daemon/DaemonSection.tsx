// app/src/daemon/DaemonSection.tsx
// The shared quiet box for one right-column section on the daemon page (inbox / crons / services /
// log): a lowercase heading + optional count text, an empty one-liner while the section has
// nothing to show, then the section's own rows as opaque children. Every section sizes to its
// content — DaemonOverview owns the column's one scroll and row-limits each section's rows so
// none of them need to scroll on their own.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import Card from '../ui/Card'
import PlainButton from '../ui/PlainButton'
import styles from './DaemonSection.module.css'

/** Anything inside the box that does its own thing on click — a row (role="button"), its actions,
 *  the more-line, the heading's own button. A click there is that item's, not the box's. Tag and
 *  role selectors only: they survive CSS-module hashing, a class name would not. */
const ITEM =
    'button, a, input, textarea, select, [role="button"], [role="menuitem"]'

export type DaemonSectionProps = {
    /** 'inbox' | 'crons' | 'services' | 'log' — rendered lowercase as given. */
    title: string
    /** Omitted → no badge (log). */
    count?: number
    /** Replaces the count's text, e.g. `2 need you`. */
    countLabel?: string
    /** This box is waiting on the user — the Card's attention edge + tint, heading in --warning. */
    attention?: boolean
    /** Makes the whole box open the section full screen: a click anywhere in it that is not on an
     *  item of its own, and the heading (a real button, for the keyboard). */
    onOpen?: () => void
    /** The muted one-liner shown under the heading while `isEmpty`. */
    empty: string
    isEmpty: boolean
    /** Always rendered, after the empty line when `isEmpty`. */
    children?: JSX.Element
    class?: string
}

function DaemonSection(props: DaemonSectionProps) {
    const countText = () =>
        props.countLabel ??
        (props.count !== undefined ? String(props.count) : undefined)
    const title = () => (
        <Text as="span" size="ui" weight="bold" class={styles.title}>
            {props.title}
        </Text>
    )
    return (
        <Card
            variant="quiet"
            attention={props.attention}
            class={`${styles.section} ${props.class ?? ''}`}
            data-section-box
            data-section={props.title}
            data-attention={props.attention ? 'true' : 'false'}
            data-testid={`daemon-section-${props.title}`}
            data-openable={props.onOpen ? 'true' : 'false'}
            onClick={(e: MouseEvent) => {
                if (!props.onOpen) return
                const item = (e.target as Element).closest(ITEM)
                if (item && (e.currentTarget as Element).contains(item)) return
                props.onOpen()
            }}
        >
            <div class={styles.heading} data-section-heading>
                <Show when={props.onOpen} fallback={title()}>
                    <PlainButton
                        aria-label={`open ${props.title}`}
                        onClick={() => props.onOpen?.()}
                    >
                        {title()}
                    </PlainButton>
                </Show>
                <div class={styles.trail}>
                    <Show when={countText() !== undefined}>
                        <Text
                            as="span"
                            size="ui"
                            tone="muted"
                            class={styles.count}
                        >
                            {countText()}
                        </Text>
                    </Show>
                </div>
            </div>
            <Show when={props.isEmpty}>
                <Text as="div" size="ui" tone="muted" class={styles.empty}>
                    {props.empty}
                </Text>
            </Show>
            <div class={styles.body}>{props.children}</div>
        </Card>
    )
}

export default DaemonSection
