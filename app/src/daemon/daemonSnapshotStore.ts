// app/src/daemon/daemonSnapshotStore.ts
// The one daemon snapshot both the daemon page and the status bar read, so the two can never
// disagree about whether the daemon is running or what it is doing. App.tsx polls it beside the
// inbox; DaemonPageHost refreshes it on its own faster timer while the page is open.
import { createSignal } from 'solid-js'
import { api } from '../api'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import { shareSnapshot } from './snapshotEquality'

/** Before the first snapshot lands: nothing configured, not (yet) known to be running. */
export const NO_SNAPSHOT: DaemonSnapshot = {
    daemon: { label: 'daemon', running: false, home: '' },
    crons: [],
    processes: [],
    identity: { name: 'daemon', blurb: '' },
}

const [snapshot, setSnapshot] = createSignal<DaemonSnapshot>(NO_SNAPSHOT)
const [loaded, setLoaded] = createSignal(false)

export const daemonSnapshot = snapshot
/** True once any snapshot has landed — until then "not running" is unknown, not a fact. */
export const daemonSnapshotLoaded = loaded

/** Best-effort: a failed fetch keeps the last good snapshot rather than blanking it. */
export async function refreshDaemonSnapshot(): Promise<void> {
    try {
        const next = await api.daemonSnapshot()
        // Equal data keeps the same object, so nothing that reads the signal re-runs.
        setSnapshot(prev => shareSnapshot(prev, next))
        setLoaded(true)
    } catch {
        /* keep the previous snapshot */
    }
}
