// app/src/daemon/DaemonPageHost.tsx
// The daemon page's container (routed by PaneContent for DAEMON_TAB). It owns everything
// DaemonPage deliberately does not: polling the snapshot + activity log, reading the shared inbox
// store App already polls, deriving the face's mood/caption and the bar readouts, and looking up
// the daemon's chat session (if any) to hand DaemonPage as its `chat` slot.
//
// The chat is GESTURE-ARMED (daemon/daemonChatArming.ts): until a trusted pointerdown/focusin lands
// on the composer, `chatSession(DAEMON_CHAT_ID)` is undefined and DaemonChat renders its
// pre-arm composer with no session — so opening this page (which app control may do) never spawns
// a `claude` session by itself. Arming asks App's `chatContents` memo to retain the session
// (chatSessions.ts); once it does, the same composer already has focus, so no separate focus
// request is needed here.
//
// Polls run only while mounted AND the daemon is enabled; a tick that lands while the document is
// hidden is skipped, and coming back into view refetches at once. All timers clear on cleanup.
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
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
import { DAEMON_CHAT_ID } from '../tabIds'
import { chatSession } from '../chat/chatSessions'
import { armDaemonChat } from './daemonChatArm'
import DaemonChat from './DaemonChat'
import { deriveMood } from './daemonFaceModel'
import { barReadouts, faceCaption, hasRecentFailure } from './daemonPageModel'
import DaemonPage from './DaemonPage'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'

export type DaemonPageHostProps = {
    onOpen: (path: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
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
    const session = () => chatSession(DAEMON_CHAT_ID)
    const conversing = () => (session()?.transcript.length ?? 0) > 0

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

    // A trusted press or focus on the composer arms the inline centre-column chat (App's chatContents memo picks
    // up the armed id and retains a session; chatSession(DAEMON_CHAT_ID) then stops being
    // undefined). The gesture lands on the composer itself, so no placeholder-to-real-composer
    // swap and no separate focus request — the composer that was just pressed/focused already has
    // focus.
    const onGesture = (e: PointerEvent | FocusEvent) => {
        armDaemonChat(e)
    }

    const status = () =>
        enabled() && !loaded()
            ? 'waking // reading the daemon'
            : faceCaption(snapshot(), mood(), now(), enabled())

    return (
        <div class="full">
            <DaemonPage
                name={daemonName()}
                enabled={enabled()}
                snapshot={snapshot()}
                pages={inboxPages()}
                events={events()}
                mood={mood()}
                readouts={
                    enabled()
                        ? barReadouts(snapshot(), dueCount(), status())
                        : [status()]
                }
                onOpen={props.onOpen}
                onChanged={onChanged}
                conversing={conversing()}
                chatFills={conversing() || !!session()?.history.open()}
                chat={
                    <DaemonChat
                        session={session()}
                        name={daemonName()}
                        onGesture={onGesture}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                }
            />
        </div>
    )
}

export default DaemonPageHost
