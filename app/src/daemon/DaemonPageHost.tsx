// app/src/daemon/DaemonPageHost.tsx
// The daemon page's container (routed by PaneContent for DAEMON_TAB). It owns everything
// DaemonPage/DaemonHub deliberately do not: polling the snapshot + activity log, reading the
// shared inbox store App already polls, deriving the face's mood/caption/facet-counts, which
// facet is showing (remembered per window in localStorage), wiring every panel's callbacks to
// `api` with a toast on failure, and looking up the daemon's chat session (if any) to hand
// DaemonHub as its `chat` slot.
//
// The chat is GESTURE-ARMED (daemon/daemonChatArming.ts): until a trusted pointerdown/focusin
// lands on the composer, `chatSession(DAEMON_CHAT_ID)` is undefined and DaemonChat renders its
// pre-arm composer with no session — so opening this page (which app control may do) never
// spawns a `claude` session by itself.
//
// Polls run only while mounted AND the daemon is enabled; a tick that lands while the document is
// hidden is skipped, and coming back into view refetches at once. All timers clear on cleanup.
import { createEffect, createMemo, createSignal, Match, onCleanup, Switch } from 'solid-js'
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
import { chatBusy, chatComposing, chatSpeaking } from '../chatActivity'
import { DAEMON_CHAT_ID } from '../tabIds'
import { chatSession } from '../chat/chatSessions'
import { armDaemonChat } from './daemonChatArm'
import { resolveWindowId } from '../windowId'
import { pushToast } from '../toastStore'
import DaemonChat from './DaemonChat'
import DaemonInbox from './DaemonInbox'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonLog from './DaemonLog'
import { deriveMood } from './daemonFaceModel'
import {
    barReadouts,
    faceCaption,
    hasRecentFailure,
    initialFacet,
    type DaemonFacet,
} from './daemonPageModel'
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
    identity: { name: 'daemon', blurb: '' },
}

const isHidden = () => document.visibilityState === 'hidden'

const facetKey = () => `bismuth.daemonFacet.${resolveWindowId()}`

function readRememberedFacet(): string | null {
    try {
        return localStorage.getItem(facetKey())
    } catch {
        return null
    }
}

function writeRememberedFacet(f: DaemonFacet): void {
    try {
        localStorage.setItem(facetKey(), f)
    } catch {
        /* best effort — a window that can't persist just re-derives next open */
    }
}

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

    // ── Facet: which ONE panel is showing ──────────────────────────────────────────────────
    // `initialFacet` picks it once at mount from whatever due-count is already known; a late-
    // arriving due count (the inbox poll landing after this component mounts) can still steer it
    // to `inbox`, but only until the user has picked a facet of their own.
    const [facet, setFacetSignal] = createSignal<DaemonFacet>(
        initialFacet(dueCount(), readRememberedFacet()),
    )
    let userPickedFacet = false
    createEffect(() => {
        if (userPickedFacet) return
        if (dueCount() > 0) setFacetSignal('inbox')
    })
    const onFacet = (f: DaemonFacet) => {
        userPickedFacet = true
        setFacetSignal(f)
        writeRememberedFacet(f)
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
            chatSpeaking: chatSpeaking(DAEMON_CHAT_ID),
        })
    })

    // A trusted press or focus on the composer arms the inline hub chat (App's chatContents memo
    // picks up the armed id and retains a session; chatSession(DAEMON_CHAT_ID) then stops being
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

    // ── Panel callbacks: every one wired to `api`. `onCreate` re-throws (no toast — the row's own
    // inline "couldn't create" message, DaemonCrons/DaemonProcesses, already shows it; toasting
    // too would show the same error twice); run/toggle/delete/forget have no such inline surface,
    // so those swallow after the toast — matching the rows' own commit helpers, which have no
    // catch of their own to feed. ────────────────────────────────────────────────────────────
    const onRunCron = async (name: string) => {
        try {
            await api.runCron(name)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't run the cron")
        }
    }
    const onToggleCron = async (name: string, on: boolean) => {
        try {
            await api.setCronEnabled(name, on)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't update the cron")
        }
    }
    const onCreateCron = async (name: string): Promise<void> => {
        const res = await api.createCron(name)
        props.onOpen(`.daemon/crons/${res.file}.md`)
        await fetchSnapshot()
    }
    const onDeleteCron = async (name: string): Promise<void> => {
        try {
            await api.deleteCron(name)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't delete the cron")
        }
    }
    const onToggleProcess = async (name: string, on: boolean) => {
        try {
            await api.setProcessEnabled(name, on)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't update the service")
        }
    }
    const onCreateProcess = async (name: string): Promise<void> => {
        const res = await api.createProcess(name)
        props.onOpen(`.daemon/processes/${res.file}.md`)
        await fetchSnapshot()
    }
    const onDeleteProcess = async (name: string): Promise<void> => {
        try {
            await api.deleteProcess(name)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't delete the service")
        }
    }
    const onEditIdentity = () => props.onOpen('.daemon/identity.md')

    return (
        <div class="full">
            <DaemonPage
                name={daemonName()}
                blurb={snapshot().identity.blurb}
                enabled={enabled()}
                mood={mood()}
                loading={enabled() && !loaded()}
                readouts={barReadouts(status())}
                facet={facet()}
                onFacet={onFacet}
                counts={{
                    due: dueCount(),
                    crons: snapshot().crons.length,
                    services: snapshot().processes.length,
                }}
                panel={
                    <Switch>
                        <Match when={facet() === 'inbox'}>
                            <DaemonInbox
                                pages={inboxPages()}
                                onOpen={props.onOpen}
                                onChanged={onChanged}
                            />
                        </Match>
                        <Match when={facet() === 'crons'}>
                            <DaemonCrons
                                crons={snapshot().crons}
                                daemonRunning={snapshot().daemon.running}
                                onOpen={props.onOpen}
                                onRun={name => void onRunCron(name)}
                                onToggle={(name, on) =>
                                    void onToggleCron(name, on)
                                }
                                onCreate={onCreateCron}
                                onDelete={onDeleteCron}
                            />
                        </Match>
                        <Match when={facet() === 'services'}>
                            <DaemonProcesses
                                processes={snapshot().processes}
                                daemonRunning={snapshot().daemon.running}
                                onOpen={props.onOpen}
                                onToggle={(name, on) =>
                                    void onToggleProcess(name, on)
                                }
                                onCreate={onCreateProcess}
                                onDelete={onDeleteProcess}
                            />
                        </Match>
                        <Match when={facet() === 'log'}>
                            <DaemonLog events={events()} />
                        </Match>
                    </Switch>
                }
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
                onEditIdentity={onEditIdentity}
            />
        </div>
    )
}

export default DaemonPageHost
