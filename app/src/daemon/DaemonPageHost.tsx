// app/src/daemon/DaemonPageHost.tsx
// The daemon page's container (routed by PaneContent for DAEMON_TAB). It owns everything
// DaemonPage/DaemonHub deliberately do not: polling the snapshot + activity log, reading the
// shared inbox store App already polls, deriving the face's mood/caption, wiring every section's
// callbacks to `api` with a toast on failure, and looking up the daemon's chat session (if any)
// to hand DaemonHub as its `chat` slot.
//
// The chat is GESTURE-ARMED (daemon/daemonChatArming.ts): until a trusted pointerdown/focusin
// lands on the composer, `chatSession(DAEMON_CHAT_ID)` is undefined and DaemonChat renders its
// pre-arm composer with no session — so opening this page (which app control may do) never
// spawns a `claude` session by itself.
//
// Polls run only while mounted AND the daemon is enabled; a tick that lands while the document is
// hidden is skipped, and coming back into view refetches at once. All timers clear on cleanup.
import {
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    Match,
    Switch,
} from 'solid-js'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import { api } from '../api'
import { settings } from '../settings'
import { daemonName } from './daemonIdentityLogic'
import {
    anyWorking,
    dueCount,
    inboxPages,
    refreshDaemonPages,
} from './daemonInboxApi'
import { chatBusy, chatComposing, chatSpeaking } from '../chat/chatActivity'
import { DAEMON_CHAT_ID } from '../tabIds'
import { chatSession } from '../chat/chatSessions'
import { armDaemonChat, armDaemonChatForDrop } from './daemonChatArm'
import { createChatDropTarget } from '../chat/createChatDropTarget'
import DropCue from '../ui/DropCue'
import styles from './DaemonPageHost.module.css'
import { pushToast } from '../ui/toastStore'
import DaemonChat from './DaemonChat'
import DaemonOverview, {
    type DaemonOverviewProps,
    type DaemonSectionKey,
} from './DaemonOverview'
import DaemonTakeover from './DaemonTakeover'
import DaemonInbox from './DaemonInbox'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonLog from './DaemonLog'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from './daemonInboxLogic'
import { cronNeedsAttention, processNeedsAttention } from './daemonAttention'
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
/** The opened log section shows up to this many events. */
const FULL_LOG_LIMIT = 500

/** Before the first snapshot lands: nothing configured, not (yet) known to be running. */
const NO_SNAPSHOT: DaemonSnapshot = {
    daemon: { label: 'daemon', running: false, home: '' },
    crons: [],
    processes: [],
    identity: { name: 'daemon', blurb: '' },
}

const isHidden = () => document.visibilityState === 'hidden'

function DaemonPageHost(props: DaemonPageHostProps) {
    const [snapshot, setSnapshot] = createSignal<DaemonSnapshot>(NO_SNAPSHOT)
    const [loaded, setLoaded] = createSignal(false)
    const [events, setEvents] = createSignal<ActivityEvent[]>([])
    const [fullEvents, setFullEvents] = createSignal<ActivityEvent[] | null>(
        null,
    )
    const [opened, setOpened] = createSignal<DaemonSectionKey | null>(null)
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
    // The poll serves both the box (60) and an opened log (FULL_LOG_LIMIT), so an opened log stays
    // live; closing it clears the full list so a reopen never shows the previous open's events.
    const fetchLogs = async () => {
        const full = opened() === 'log'
        try {
            const ev = await api.daemonLogs({
                limit: full ? FULL_LOG_LIMIT : LOG_LIMIT,
            })
            setEvents(full ? ev.slice(0, LOG_LIMIT) : ev)
            if (full) setFullEvents(ev)
        } catch {
            /* keep the previous log */
        }
    }
    createEffect(
        on(opened, k => (k === 'log' ? void fetchLogs() : setFullEvents(null))),
    )

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

    // The whole page is a drop target for the daemon's chat: a draggable dropped anywhere on it arms
    // the chat (the drop is the gesture) and lands in its composer once the session is up.
    let host: HTMLDivElement | undefined
    const drop = createChatDropTarget(
        () => DAEMON_CHAT_ID,
        () => (enabled() ? host : undefined),
        { beforeDrop: armDaemonChatForDrop },
    )

    const status = () =>
        enabled() && !loaded()
            ? 'waking // reading the daemon'
            : faceCaption(snapshot(), mood(), now(), enabled())

    // ── Section callbacks: every one wired to `api`, each swallowing after its toast — matching
    // the rows' own commit helpers, which have no catch of their own to feed. There is no create:
    // crons and services are created by asking the daemon in chat (it writes the definition via
    // `bismuth daemon cron|process create`, the user approving the call), never from the page. ──
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
    const onDeleteProcess = async (name: string): Promise<void> => {
        try {
            await api.deleteProcess(name)
            await fetchSnapshot()
        } catch (e) {
            pushToast((e as Error).message || "couldn't delete the service")
        }
    }
    const onEditIdentity = () => props.onOpen('.daemon/identity.md')

    // What DaemonOverview needs to size each section's dynamic row limit — attention floors it
    // never cuts into, plus the inbox's own trailing "N resolved" line, which costs a row
    // of height too when it's rendered.
    const rows = (): DaemonOverviewProps['rows'] => {
        const pages = inboxPages()
        const now = Date.now()
        const due = dueSorted(pages, now).length
        const failed = failedSorted(pages).length
        const scheduled = scheduledSorted(pages, now).length
        const resolved = resolvedSorted(pages).length
        const snap = snapshot()
        return {
            inbox: {
                total: due + failed + scheduled,
                attention: due + failed,
                extraLines: resolved > 0 ? 1 : 0,
            },
            crons: {
                total: snap.crons.length,
                attention: snap.crons.filter(c =>
                    cronNeedsAttention(c, snap.daemon.running),
                ).length,
            },
            services: {
                total: snap.processes.length,
                attention: snap.processes.filter(p =>
                    processNeedsAttention(p, snap.daemon.running),
                ).length,
            },
            log: { total: events().length, attention: 0 },
        }
    }

    const close = () => setOpened(null)
    const pagesOpenCount = () => {
        const pages = inboxPages()
        const t = Date.now()
        return (
            dueSorted(pages, t).length +
            failedSorted(pages).length +
            scheduledSorted(pages, t).length
        )
    }

    // The section the opened view renders: the open one, else the last one opened, so DaemonPage's
    // shrink-back animation still has the section's content after `opened` clears.
    const lastOpened = createMemo<DaemonSectionKey | null>(
        prev => opened() ?? prev,
        null,
    )
    const openedView = () => (
        <Switch>
            <Match when={lastOpened() === 'inbox'}>
                <DaemonTakeover
                    title="inbox"
                    count={pagesOpenCount()}
                    onClose={close}
                >
                    <DaemonInbox
                        variant="full"
                        pages={inboxPages()}
                        onOpen={props.onOpen}
                        onChanged={onChanged}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'crons'}>
                <DaemonTakeover
                    title="crons"
                    count={snapshot().crons.length}
                    onClose={close}
                >
                    <DaemonCrons
                        variant="full"
                        crons={snapshot().crons}
                        daemonRunning={snapshot().daemon.running}
                        onOpen={props.onOpen}
                        onRun={name => void onRunCron(name)}
                        onToggle={(name, on) => void onToggleCron(name, on)}
                        onDelete={onDeleteCron}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'services'}>
                <DaemonTakeover
                    title="services"
                    count={snapshot().processes.length}
                    onClose={close}
                >
                    <DaemonProcesses
                        variant="full"
                        processes={snapshot().processes}
                        daemonRunning={snapshot().daemon.running}
                        onOpen={props.onOpen}
                        onToggle={(name, on) => void onToggleProcess(name, on)}
                        onDelete={onDeleteProcess}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'log'}>
                <DaemonTakeover title="log" onClose={close}>
                    <DaemonLog
                        variant="full"
                        events={fullEvents() ?? events()}
                    />
                </DaemonTakeover>
            </Match>
        </Switch>
    )

    return (
        <div
            class={`full ${styles.host}`}
            ref={host}
            onDragOver={e => enabled() && drop.onDragOver(e)}
            onDragLeave={drop.onDragLeave}
            onDrop={e => enabled() && drop.onDrop(e)}
        >
            <DropCue active={drop.dragActive()} />
            <DaemonPage
                name={daemonName()}
                blurb={snapshot().identity.blurb}
                enabled={enabled()}
                mood={mood()}
                loading={enabled() && !loaded()}
                readouts={barReadouts(status())}
                overview={
                    <DaemonOverview
                        rows={rows()}
                        inbox={limit => (
                            <DaemonInbox
                                pages={inboxPages()}
                                limit={limit()}
                                onOpen={props.onOpen}
                                onChanged={onChanged}
                                onOpenSection={() => setOpened('inbox')}
                            />
                        )}
                        crons={limit => (
                            <DaemonCrons
                                crons={snapshot().crons}
                                daemonRunning={snapshot().daemon.running}
                                limit={limit()}
                                onOpen={props.onOpen}
                                onRun={name => void onRunCron(name)}
                                onToggle={(name, on) =>
                                    void onToggleCron(name, on)
                                }
                                onDelete={onDeleteCron}
                                onOpenSection={() => setOpened('crons')}
                            />
                        )}
                        services={limit => (
                            <DaemonProcesses
                                processes={snapshot().processes}
                                daemonRunning={snapshot().daemon.running}
                                limit={limit()}
                                onOpen={props.onOpen}
                                onToggle={(name, on) =>
                                    void onToggleProcess(name, on)
                                }
                                onDelete={onDeleteProcess}
                                onOpenSection={() => setOpened('services')}
                            />
                        )}
                        log={limit => (
                            <DaemonLog
                                events={events()}
                                limit={limit()}
                                onOpenSection={() => setOpened('log')}
                            />
                        )}
                    />
                }
                opened={opened()}
                openedView={openedView()}
                conversing={conversing()}
                // Only a conversation fills the region now — chat history opens as a dialog over
                // the page (chat/ChatHistoryModal.tsx), not as a pane inside it.
                chatFills={conversing()}
                chat={
                    <DaemonChat
                        session={session()}
                        name={daemonName()}
                        mood={mood()}
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
