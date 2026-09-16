// app/src/daemon/DaemonPage.tsx
// The daemon page — "face as hub". Presentational only: DaemonPageHost fetches and derives, this
// lays it out. A ViewBar on top; a three-column stage (crons + services LEFT, the living face +
// its own chat CENTRE, inbox over log RIGHT) filling the page — no band across the bottom.
//
// The centre column's chat is a slot: `props.chat`. The host passes the real chat surface (Task 6);
// stories pass a stub. `props.conversing` decides the face's compact size; `props.chatFills`
// decides how the column splits between the face and that chat — see DaemonPage.module.css.
//
// Off (`enabled === false`): the face sleeps, the side columns disappear and the centre column
// gives way to one EmptyState saying how to wake it — and there is no chat at all.
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
    /** The centre column's chat, rendered under the face. Host passes <DaemonChat/>; stories a stub.
     *  Expected to fill the height it is given (transcript scrolls, composer pinned to its bottom). */
    chat: JSX.Element
    /** true once the conversation has any items: face goes compact at the top and the chat takes
     *  the remaining height. false: face + caption centred above the composer. */
    conversing: boolean
    /** The centre column's chat region fills the column instead of sizing to its content.
     *  True while conversing, and also while the history pane has taken the region over —
     *  a full-height pane in a content-height box would be a sliver. */
    chatFills: boolean
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
            <div class={styles.stage} data-testid="daemon-page-stage">
                <Show when={props.enabled}>
                    <DaemonServices
                        class={styles.left}
                        crons={props.snapshot.crons}
                        processes={props.snapshot.processes}
                        daemonRunning={props.snapshot.daemon.running}
                        onOpen={props.onOpen}
                        onChanged={props.onChanged}
                    />
                </Show>
                <div class={styles.hub} data-testid="daemon-page-hub">
                    <div
                        class={`${styles.faceRegion} ${props.conversing ? styles.faceCompact : ''}`}
                    >
                        <DaemonFace
                            mood={props.mood}
                            caption={props.caption}
                            compact={props.conversing}
                        />
                        <Show when={!props.enabled}>
                            <EmptyState class={styles.off} title="wake it up">
                                Set daemon.enabled: true in .settings to wake it.
                            </EmptyState>
                        </Show>
                    </div>
                    <Show when={props.enabled}>
                        <div
                            class={`${styles.chatRegion} ${props.chatFills ? styles.chatFill : ''}`}
                            data-testid="daemon-page-chat"
                        >
                            {props.chat}
                        </div>
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
        </div>
    )
}

export default DaemonPage
