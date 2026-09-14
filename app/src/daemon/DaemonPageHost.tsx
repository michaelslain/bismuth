// app/src/daemon/DaemonPageHost.tsx
// The daemon page's container (routed by PaneContent for DAEMON_TAB). It owns everything
// DaemonPage deliberately does not: polling the snapshot + activity log, reading the shared inbox
// store App already polls, deriving the face's mood/caption and the bar readouts, and handing the
// chat band a `data-chat-host` placeholder for App's chat overlay to cover.
//
// Polls run only while mounted AND the daemon is enabled; a tick that lands while the document is
// hidden is skipped, and coming back into view refetches at once. All timers clear on cleanup.
import {
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from 'solid-js'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import { api } from '../api'
import { settings } from '../settings'
import { daemonName } from '../daemonIdentity'
import {
    anyWorking,
    dueCount,
    inboxPages,
    refreshDaemonPages,
} from '../daemonInbox'
import { chatBusy, chatComposing } from '../chatActivity'
import { CHAT_PREFIX, DAEMON_CHAT_ID } from '../tabIds'
import { requestOverlayMeasure } from '../overlayHosts'
import { deriveMood } from './daemonFaceModel'
import { barReadouts, faceCaption, hasRecentFailure } from './daemonPageModel'
import DaemonPage from './DaemonPage'

export type DaemonPageHostProps = {
    onOpen: (path: string) => void
}

const SNAPSHOT_POLL_MS = 4000
const LOGS_POLL_MS = 5000
const LOG_LIMIT = 60

/** Before the first snapshot lands: nothing configured, not (yet) known to be running. */
const NO_SNAPSHOT: DaemonSnapshot = {
    daemon: { label: 'daemon', running: false, home: '' },
    crons: [],
    processes: [],
}

const isHidden = () => document.visibilityState === 'hidden'

function DaemonPageHost(props: DaemonPageHostProps) {
    const [snapshot, setSnapshot] = createSignal<DaemonSnapshot>(NO_SNAPSHOT)
    const [loaded, setLoaded] = createSignal(false)
    const [events, setEvents] = createSignal<ActivityEvent[]>([])
    const [now, setNow] = createSignal(Date.now())
    const enabled = () => settings.daemon.enabled

    // Best-effort: a failed poll keeps the last good data on screen rather than blanking it.
    const fetchSnapshot = async () => {
        try {
            setSnapshot(await api.daemonSnapshot())
            setLoaded(true)
        } catch {
            /* keep the previous snapshot */
        }
        setNow(Date.now())
    }
    const fetchLogs = async () => {
        try {
            setEvents(await api.daemonLogs({ limit: LOG_LIMIT }))
        } catch {
            /* keep the previous log */
        }
    }

    createEffect(() => {
        if (!enabled()) return
        void fetchSnapshot()
        void fetchLogs()
        const snap = setInterval(() => {
            if (!isHidden()) void fetchSnapshot()
        }, SNAPSHOT_POLL_MS)
        const logs = setInterval(() => {
            if (!isHidden()) void fetchLogs()
        }, LOGS_POLL_MS)
        const onVisible = () => {
            if (isHidden()) return
            void fetchSnapshot()
            void fetchLogs()
        }
        document.addEventListener('visibilitychange', onVisible)
        onCleanup(() => {
            clearInterval(snap)
            clearInterval(logs)
            document.removeEventListener('visibilitychange', onVisible)
        })
    })

    const onChanged = () => {
        void fetchSnapshot()
        void refreshDaemonPages()
    }

    const mood = createMemo(() => {
        const snap = snapshot()
        return deriveMood({
            enabled: enabled(),
            running: snap.daemon.running,
            cronsRunning: snap.crons.filter(c => c.running).length,
            recentFailure: hasRecentFailure(snap.crons, now()),
            inboxDue: dueCount(),
            inboxWorking: anyWorking(),
            chatBusy: chatBusy(DAEMON_CHAT_ID),
            composing: chatComposing(DAEMON_CHAT_ID),
        })
    })

    const caption = () =>
        enabled() && !loaded()
            ? 'waking // reading the daemon'
            : faceCaption(snapshot(), mood(), now())

    // App measures overlay hosts when the active tab changes. This page arrives a chunk load
    // later (lazy route) and its chat band comes and goes with `daemon.enabled` — and the band is
    // height-clamped, so a pane resize can MOVE it without resizing it. Each of those asks App to
    // re-measure (overlayHosts.ts) so the docked chat never strands over a stale rect.
    let root: HTMLDivElement | undefined
    createEffect(() => {
        enabled()
        queueMicrotask(requestOverlayMeasure)
    })
    onMount(() => {
        if (!root || typeof ResizeObserver === 'undefined') return
        let frame = 0
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(requestOverlayMeasure)
        })
        ro.observe(root)
        onCleanup(() => {
            cancelAnimationFrame(frame)
            ro.disconnect()
        })
    })
    onCleanup(() => queueMicrotask(requestOverlayMeasure))

    return (
        <div ref={root} class="full">
            <DaemonPage
                name={daemonName()}
                enabled={enabled()}
                snapshot={snapshot()}
                pages={inboxPages()}
                events={events()}
                mood={mood()}
                caption={caption()}
                readouts={barReadouts(snapshot(), dueCount())}
                onOpen={props.onOpen}
                onChanged={onChanged}
                chat={
                    <div
                        data-chat-host={CHAT_PREFIX + DAEMON_CHAT_ID}
                        class="full"
                    />
                }
            />
        </div>
    )
}

export default DaemonPageHost
