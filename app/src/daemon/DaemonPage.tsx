// app/src/daemon/DaemonPage.tsx
// The daemon page — the FULL overview, always. Presentational only: DaemonPageHost fetches and
// derives, this lays it out. A ViewBar on top carries only identity and the status readout — no
// facet toggle any more, every section shows at once. Below it, a two-column stage: DaemonHub
// (the face, its identity, its own chat) on the left, the right column (`props.overview` — the
// host's <DaemonOverview/>: inbox, crons, services, log stacked top to bottom, the log filling
// the rest) on the right — handed in as a slot so this file never imports DaemonInbox/
// DaemonCrons/DaemonProcesses/DaemonLog/DaemonOverview directly.
//
// Off (`enabled === false`): DaemonHub itself sleeps (no identity, no chat) and this file drops
// the overview column entirely — leaving one EmptyState under the face saying how to wake it.
import { Index, Show, type JSX } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import Text from '../ui/Text'
import DaemonHub from './DaemonHub'
import type { DaemonMood } from './daemonFaceModel'
import styles from './DaemonPage.module.css'

export type DaemonPageProps = {
    name: string
    /** The daemon's personality blurb — `identity.md`'s first body line. `''` renders nothing. */
    blurb: string
    enabled: boolean
    mood: DaemonMood
    /** True while the host has no snapshot yet — forwarded to DaemonHub/DaemonFace so the first
     *  real mood paints immediately instead of settling against the provisional one. */
    loading?: boolean
    /** The ONE trailing readout — the status string, or empty (see daemonPageModel.barReadouts). */
    readouts: string[]
    /** The right column — the host passes <DaemonOverview/>. */
    overview: JSX.Element
    /** The hub's own chat, rendered under the face/identity. Host passes <DaemonChat/>; stories
     *  a stub. Expected to fill the height it's given. */
    chat: JSX.Element
    /** true once the conversation has any items. See `chatFills`. */
    conversing: boolean
    /** The hub's chat region fills the column instead of sizing to its content — true while
     *  conversing, and also while a full-height pane (like chat history) has taken the region. */
    chatFills: boolean
    onEditIdentity: () => void
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
                parts={{ trail: styles.barTrail, readouts: styles.barReadouts }}
                identity={<Crumb icon="Bot">{props.name}</Crumb>}
                readouts={
                    <Show when={props.readouts.length > 0}>
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
                <DaemonHub
                    class={styles.hub}
                    name={props.name}
                    blurb={props.blurb}
                    mood={props.mood}
                    loading={props.loading}
                    enabled={props.enabled}
                    conversing={props.conversing}
                    chatFills={props.chatFills}
                    chat={props.chat}
                    onEditIdentity={props.onEditIdentity}
                />
                <Show when={props.enabled}>
                    <div class={styles.panel} data-testid="daemon-page-overview">
                        {props.overview}
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default DaemonPage
