// app/src/daemon/DaemonPage.tsx
// The daemon page — "hub + one panel". Presentational only: DaemonPageHost fetches and derives,
// this lays it out. A ViewBar on top — identity, a SegmentedToggle across the four facets
// (inbox/crons/services/log, each labelled with its own count), and the status readout
// alone (the old cron/service COUNTS moved onto the facet labels, see daemonPageModel.ts's
// facetCount). Below it, a two-column stage: DaemonHub (the face, its identity, its own chat) on
// the left, whichever ONE panel the current facet names on the right — handed in as a slot
// (`props.panel`) so this file never imports DaemonCrons/DaemonProcesses/DaemonInbox/
// DaemonLog directly; the host picks the panel for the facet and wires its callbacks.
//
// Off (`enabled === false`): DaemonHub itself sleeps (no identity, no chat) and this file drops
// the facet toggle and the panel entirely — there's nothing to facet over while the daemon is
// off — leaving one EmptyState under the face saying how to wake it.
import { Index, Show, type JSX } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import Text from '../ui/Text'
import SegmentedToggle, { type SegmentedOption } from '../ui/SegmentedToggle'
import DaemonHub from './DaemonHub'
import type { DaemonMood } from './daemonFaceModel'
import {
    DAEMON_FACETS,
    facetCount,
    type DaemonFacet,
} from './daemonPageModel'
import styles from './DaemonPage.module.css'

export type DaemonFacetCounts = {
    due: number
    crons: number
    services: number
}

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
    facet: DaemonFacet
    onFacet: (f: DaemonFacet) => void
    counts: DaemonFacetCounts
    /** The current facet's panel — the host picks + wires it (DaemonCrons/DaemonProcesses/
     *  DaemonInbox/DaemonLog). */
    panel: JSX.Element
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

const FACET_WORD: Record<DaemonFacet, string> = {
    inbox: 'inbox',
    crons: 'crons',
    services: 'services',
    log: 'log',
}

function DaemonPage(props: DaemonPageProps) {
    const options = (): SegmentedOption<DaemonFacet>[] =>
        DAEMON_FACETS.map(f => {
            const count = facetCount(f, props.counts)
            return {
                id: f,
                ariaLabel:
                    count === undefined
                        ? FACET_WORD[f]
                        : `${FACET_WORD[f]} ${count}`,
                label: (
                    <>
                        {FACET_WORD[f]}
                        <Show when={count !== undefined}>
                            {' '}
                            <Text as="span" size="ui" tone="faint">
                                {count}
                            </Text>
                        </Show>
                    </>
                ),
            }
        })

    return (
        <div
            class={`${styles.page} ${props.class ?? ''}`}
            data-enabled={props.enabled ? 'true' : 'false'}
            data-testid="daemon-page"
        >
            <ViewBar
                parts={{ trail: styles.barTrail, readouts: styles.barReadouts }}
                identity={<Crumb icon="Bot">{props.name}</Crumb>}
                facet={
                    <Show when={props.enabled}>
                        <SegmentedToggle
                            options={options()}
                            value={props.facet}
                            onChange={props.onFacet}
                        />
                    </Show>
                }
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
                    <div class={styles.panel} data-testid="daemon-page-panel">
                        {props.panel}
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default DaemonPage
