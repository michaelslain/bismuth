// app/src/daemon/DaemonOverview.tsx
// The daemon page's right column: inbox, crons, services, log stacked top to bottom, each an
// opaque `DaemonSection` handed in by the caller — this component owns only the stack's layout,
// never the list components themselves (DaemonPage wires those in). The log slot takes whatever
// height is left under the other three and lets its own `DaemonSection` (fill) scroll internally;
// narrow drops that behaviour for a stage that scrolls as a whole with a capped log slot.
import styles from './DaemonOverview.module.css'
import type { JSX } from 'solid-js'

export type DaemonOverviewProps = {
    inbox: JSX.Element
    crons: JSX.Element
    services: JSX.Element
    log: JSX.Element
    class?: string
}

function DaemonOverview(props: DaemonOverviewProps) {
    return (
        <div
            class={`${styles.overview} ${props.class ?? ''}`}
            data-testid="daemon-overview"
        >
            <div class={styles.slot}>{props.inbox}</div>
            <div class={styles.slot}>{props.crons}</div>
            <div class={styles.slot}>{props.services}</div>
            <div class={`${styles.slot} ${styles.logSlot}`}>{props.log}</div>
        </div>
    )
}

export default DaemonOverview
