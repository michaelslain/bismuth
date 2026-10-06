// app/src/daemon/DaemonHub.tsx
// The daemon page's left column — the hub, drawn as ONE quiet box: a header row (the daemon's
// name, a DaemonIdentity trigger hiding its blurb + `[ edit ]` behind hover/focus, and the faint
// mood word), the living face centred in the middle, and the daemon's own chat pinned to the box
// bottom. Once a conversation has messages the face goes entirely (it rides the transcript's
// lowest assistant row instead) and the chat fills everything under the header, so the composer
// sits on the box's bottom edge in both states.
// Presentational: the host derives mood/blurb and owns the chat session; this only lays the
// box out.
//
// Off (`enabled === false`): no box, no identity, no chat — the sleeping face alone with how to
// wake it, exactly as before.
import { Show, type JSX } from 'solid-js'
import Card from '../ui/Card'
import Text from '../ui/Text'
import EmptyState from '../ui/EmptyState'
import DaemonFace from './DaemonFace'
import DaemonIdentity from './DaemonIdentity'
import { moodWord, type DaemonMood } from './daemonFaceModel'
import styles from './DaemonHub.module.css'

export type DaemonHubProps = {
    name: string
    blurb: string
    mood: DaemonMood
    /** True while the host has no snapshot yet — forwarded to DaemonFace so the first real mood
     *  paints immediately instead of settling against the provisional NO_SNAPSHOT-derived one. */
    loading?: boolean
    enabled: boolean
    /** true once the conversation has any items — the face is dropped, since the face then rides
     *  the transcript's lowest assistant row instead. */
    conversing: boolean
    /** The chat region fills the box under the header instead of sitting under the face — true
     *  while conversing, and also while a full-height pane has taken the region over. */
    chatFills: boolean
    /** Rendered at the box bottom. Host passes <DaemonChat/>; stories a stub. */
    chat: JSX.Element
    onEditIdentity: () => void
    class?: string
}

function DaemonHub(props: DaemonHubProps) {
    const fills = () => props.chatFills || props.conversing

    return (
        <Show
            when={props.enabled}
            fallback={
                <div
                    class={`${styles.off} ${props.class ?? ''}`}
                    data-testid="daemon-page-hub"
                    data-resting="true"
                >
                    <div class={styles.offFace} data-testid="daemon-face-region">
                        <DaemonFace mood={props.mood} loading={props.loading} size="hero" />
                        <EmptyState class={styles.offLine}>
                            set daemon.enabled: true in .settings to wake it
                        </EmptyState>
                    </div>
                </div>
            }
        >
            <Card
                variant="quiet"
                class={`${styles.hub} ${props.class ?? ''}`}
                data-testid="daemon-page-hub"
                data-resting={fills() ? 'false' : 'true'}
            >
                <div class={styles.header}>
                    <DaemonIdentity
                        name={props.name}
                        blurb={props.blurb}
                        onEdit={props.onEditIdentity}
                    />
                    <Text as="span" size="ui" tone="faint">
                        {moodWord(props.mood)}
                    </Text>
                </div>
                <Show when={!fills()}>
                    <div class={styles.faceRegion} data-testid="daemon-face-region">
                        <DaemonFace
                            mood={props.mood}
                            loading={props.loading}
                            size="hero"
                        />
                    </div>
                </Show>
                <div
                    class={`${styles.chatRegion} ${fills() ? styles.chatFill : ''}`}
                    data-testid="daemon-page-chat"
                >
                    {props.chat}
                </div>
            </Card>
        </Show>
    )
}

export default DaemonHub
