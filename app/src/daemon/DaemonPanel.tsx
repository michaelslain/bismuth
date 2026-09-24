// app/src/daemon/DaemonPanel.tsx
// The one shared frame a daemon-page panel (crons, services, inbox, log) can compose: an
// optional plain title + count badge + optional trailing actions in a head row, over a body that
// scrolls internally. With only ONE panel showing at a time and the ViewBar facet acting as its
// heading, there is no border box and no letter-spaced eyebrow here any more — the head row
// itself only renders when `title` or `actions` is given, so a panel with neither (most of
// DaemonInbox/DaemonLog now) is chromeless top to bottom. The daemon page is a hub column plus
// one panel column, and each panel must fill its cell's height and never grow the page, which is
// why the body — not the panel — carries `overflow-y: auto`.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
import styles from './DaemonPanel.module.css'

export type DaemonPanelProps = {
    /** A small plain label, no eyebrow tracking. Optional — no caller passes one any more (the
     *  ViewBar facet is every panel's heading now: DaemonCrons/DaemonProcesses/DaemonInbox all
     *  pass `actions` alone). Kept on the type for DaemonPanel.stories.tsx's own demo shape. */
    title?: string
    count?: number
    actions?: JSX.Element
    children: JSX.Element
    /** Size to content (capped by the caller's max-height) instead of filling the cell. */
    packToContent?: boolean
    class?: string
}

function DaemonPanel(props: DaemonPanelProps) {
    const hasHead = () => props.title !== undefined || props.actions !== undefined
    return (
        <div
            class={`${styles['daemon-panel']} ${props.class ?? ''}`}
            classList={{ [styles['pack-to-content']]: props.packToContent }}
        >
            <Show when={hasHead()}>
                <div class={styles['daemon-panel-head']}>
                    <Show when={props.title !== undefined}>
                        <Text
                            as="div"
                            size="micro"
                            tone="faint"
                            class={styles['daemon-panel-title']}
                        >
                            {props.title}
                        </Text>
                    </Show>
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
            </Show>
            <div class={styles['daemon-panel-body']}>{props.children}</div>
        </div>
    )
}

export default DaemonPanel

/** `blockClass` for an `<EmptyState>` rendered inside a `DaemonPanel`'s body (DaemonInbox,
 *  DaemonProcesses, DaemonLog all pass this) — the inset + row-matched font-size a panel's empty
 *  state needs, formerly `.daemon-panel-body > :global(.ui-empty-block)` reaching EmptyState's
 *  internals by class name. DaemonPanel itself never renders `<EmptyState>` (its `children` are
 *  opaque), so this is exported for each caller to hand to its own `<EmptyState blockClass={...}>`
 *  instead. */
export const daemonPanelEmptyClass = styles['panel-empty']
