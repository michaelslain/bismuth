// app/src/daemon/DaemonHub.tsx
// The daemon page's left column — the hub: the living face, the daemon's name (a DaemonIdentity
// trigger hiding its blurb + `[ edit ]` behind hover/focus), and its own chat underneath.
// Presentational: the host derives mood/blurb and owns the chat session; this only lays the
// column out.
//
// Resting, DaemonIdentity sits centred under the full-size face, showing only the name — its
// blurb + `[ edit ]` card stays hidden until hovered or focused (see DaemonIdentity.tsx). Once the
// chat has taken the column (conversing, or a full-height pane like chat history — see
// `chatFills`), the face collapses to DaemonFace's own `compact` one-line-header form and the
// identity shrinks to a bare name riding beside it — no hover card, there's no room for it next
// to a one-line header.
//
// Off (`enabled === false`): no identity, no chat — DaemonFace stays asleep and the caller
// (DaemonPage) is the one that decides what replaces this column's usual content.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import EmptyState from '../ui/EmptyState'
import DaemonFace from './DaemonFace'
import DaemonIdentity from './DaemonIdentity'
import type { DaemonMood } from './daemonFaceModel'
import styles from './DaemonHub.module.css'

export type DaemonHubProps = {
    name: string
    blurb: string
    mood: DaemonMood
    /** True while the host has no snapshot yet — forwarded to DaemonFace so the first real mood
     *  paints immediately instead of settling against the provisional NO_SNAPSHOT-derived one. */
    loading?: boolean
    enabled: boolean
    /** true once the conversation has any items. No longer drives the face directly — see
     *  `chatFills`, which also covers a full-height pane (like chat history) taking the region. */
    conversing: boolean
    /** The chat region fills the column instead of sizing to its content — true while
     *  conversing, and also while a full-height pane has taken the region over. Also what
     *  collapses the face + identity to the one-line header form. */
    chatFills: boolean
    /** Rendered under the identity, filling the rest of the column. Host passes <DaemonChat/>;
     *  stories a stub. */
    chat: JSX.Element
    onEditIdentity: () => void
    class?: string
}

function DaemonHub(props: DaemonHubProps) {
    const compact = () => props.chatFills

    // Compact (conversing / chatFills): keep today's one-line-header behaviour — name only, no
    // hover card, there's no room next to a one-line header for either. Resting: the name is a
    // DaemonIdentity trigger, whose blurb + [ edit ] live in a card hidden until hovered/focused.
    const identity = () => (
        <Show
            when={!compact()}
            fallback={
                <Text as="span" size="ui" tone="default" class={styles.name}>
                    {props.name}
                </Text>
            }
        >
            <DaemonIdentity
                name={props.name}
                blurb={props.blurb}
                onEdit={props.onEditIdentity}
            />
        </Show>
    )

    return (
        <div class={`${styles.hub} ${props.class ?? ''}`} data-testid="daemon-page-hub">
            <div
                class={`${styles.faceRegion} ${compact() ? styles.faceCompact : ''}`}
            >
                <DaemonFace
                    mood={props.mood}
                    loading={props.loading}
                    compact={compact()}
                    caption={props.enabled ? identity() : undefined}
                />
                <Show when={!props.enabled}>
                    <EmptyState class={styles.off} title="wake it up">
                        Set daemon.enabled: true in .settings to wake it.
                    </EmptyState>
                </Show>
            </div>
            <Show when={props.enabled}>
                <div
                    class={`${styles.chatRegion} ${compact() ? styles.chatFill : ''}`}
                    data-testid="daemon-page-chat"
                >
                    {props.chat}
                </div>
            </Show>
        </div>
    )
}

export default DaemonHub
