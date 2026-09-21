// app/src/daemon/DaemonPanel.tsx
// The one shared panel frame for every daemon-page panel (crons, services, inbox, log): an
// eyebrow title + count badge + optional trailing actions in a fixed head, over a body that
// scrolls internally. THE ONLY OWNER of panel chrome styles (border, head, scroll) — every other
// daemon component composes this rather than growing its own hairline box. Task 6 lays four of
// these into a three-column grid; each must fill its cell's height and never grow the page, which
// is why the body — not the panel — carries `overflow-y: auto`.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
import styles from './DaemonPanel.module.css'

export type DaemonPanelProps = {
    title: string
    count?: number
    actions?: JSX.Element
    children: JSX.Element
    /** Size to content (capped by the caller's max-height) instead of filling the cell. */
    packToContent?: boolean
    class?: string
}

function DaemonPanel(props: DaemonPanelProps) {
    return (
        <div
            class={`${styles['daemon-panel']} ${props.class ?? ''}`}
            classList={{ [styles['pack-to-content']]: props.packToContent }}
        >
            <div class={styles['daemon-panel-head']}>
                <Text
                    as="div"
                    eyebrow
                    size="micro"
                    tone="faint"
                    class={styles['daemon-panel-title']}
                >
                    {props.title}
                </Text>
                <Show when={props.count !== undefined}>
                    <Badge class={styles['daemon-panel-count']}>
                        {props.count}
                    </Badge>
                </Show>
                <Show when={props.actions}>
                    <div class={styles['daemon-panel-actions']}>
                        {props.actions}
                    </div>
                </Show>
            </div>
            <div class={styles['daemon-panel-body']}>{props.children}</div>
        </div>
    )
}

export default DaemonPanel

/** `blockClass` for an `<EmptyState>` rendered inside a `DaemonPanel`'s body (DaemonInbox,
 *  DaemonServices, DaemonLog all pass this) — the inset + row-matched font-size a panel's empty
 *  state needs, formerly `.daemon-panel-body > :global(.ui-empty-block)` reaching EmptyState's
 *  internals by class name. DaemonPanel itself never renders `<EmptyState>` (its `children` are
 *  opaque), so this is exported for each caller to hand to its own `<EmptyState blockClass={...}>`
 *  instead. */
export const daemonPanelEmptyClass = styles['panel-empty']
