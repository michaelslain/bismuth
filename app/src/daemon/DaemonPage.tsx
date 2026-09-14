// app/src/daemon/DaemonPage.tsx
// The daemon page — "face as hub". Presentational only: DaemonPageHost fetches and derives, this
// lays it out. A ViewBar on top; a three-column stage (crons + services LEFT, the living face
// CENTRE, inbox over log RIGHT); the chat band across the bottom. Every panel is a composed
// daemon component — the page only PLACES them (DaemonPanel owns their chrome).
//
// The chat band's content is a slot: the host passes a `data-chat-host` placeholder that App's
// always-mounted chat overlay covers with the real ChatView (variant="dock"). Stories pass a stub.
//
// Off (`enabled === false`): the face sleeps, the side columns give way to one EmptyState saying
// how to wake it, and there is no chat band at all.
import { Index, Show, type JSX } from 'solid-js'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { DaemonPage as InboxPage } from '../../../core/src/daemonPages'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import ViewBar, { Crumb } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import Text from '../ui/Text'
import EmptyState from '../ui/EmptyState'
import DaemonFace from './DaemonFace'
import DaemonServices from './DaemonServices'
import DaemonInbox from './DaemonInbox'
import DaemonLog from './DaemonLog'
import type { DaemonMood } from './daemonFaceModel'
import styles from './DaemonPage.module.css'

export type DaemonPageProps = {
    name: string
    enabled: boolean
    snapshot: DaemonSnapshot
    pages: InboxPage[]
    events: ActivityEvent[]
    mood: DaemonMood
    caption: string
    readouts: string[]
    onOpen: (path: string) => void
    onChanged: () => void
    /** The chat band's content. The host passes `<div data-chat-host={CHAT_PREFIX + DAEMON_CHAT_ID} />`;
     *  stories pass a stub. */
    chat: JSX.Element
    class?: string
}

function DaemonPage(props: DaemonPageProps) {
    return (
        <div
            class={`${styles.page} ${props.class ?? ''}`}
            data-enabled={props.enabled ? 'true' : 'false'}
            data-testid="daemon-page"
        >
            <ViewBar
                identity={<Crumb icon="Bot">{props.name}</Crumb>}
                readouts={
                    <Show when={props.enabled}>
                        <Index each={props.readouts}>
                            {(r, i) => (
                                <>
                                    <Show when={i > 0}>
                                        <Text
                                            as="span"
                                            size="ui"
                                            tone="faint"
                                            class={styles.sep}
                                        >
                                            //
                                        </Text>
                                    </Show>
                                    <BarLabel long={r()} />
                                </>
                            )}
                        </Index>
                    </Show>
                }
            />
            <div class={styles.stage}>
                <Show when={props.enabled}>
                    <DaemonServices
                        class={styles.left}
                        crons={props.snapshot.crons}
                        processes={props.snapshot.processes}
                        onOpen={props.onOpen}
                        onChanged={props.onChanged}
                    />
                </Show>
                <div class={styles.hub} data-testid="daemon-page-hub">
                    <DaemonFace
                        class={styles.face}
                        mood={props.mood}
                        caption={props.caption}
                    />
                    <Show when={!props.enabled}>
                        <EmptyState class={styles.off} title="the daemon is off">
                            Set daemon.enabled: true in .settings to wake it.
                        </EmptyState>
                    </Show>
                </div>
                <Show when={props.enabled}>
                    <div class={styles.right}>
                        <DaemonInbox
                            class={styles.inbox}
                            pages={props.pages}
                            onOpen={props.onOpen}
                            onChanged={props.onChanged}
                        />
                        <DaemonLog class={styles.log} events={props.events} />
                    </div>
                </Show>
            </div>
            <Show when={props.enabled}>
                <div class={styles.band} data-testid="daemon-page-chat">
                    {props.chat}
                </div>
            </Show>
        </div>
    )
}

export default DaemonPage
