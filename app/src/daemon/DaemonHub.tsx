// app/src/daemon/DaemonHub.tsx
// The daemon page's left column — the hub: the living face, the daemon's name + one-line
// personality blurb, an `[ edit ]` bracket button to its identity note, and its own chat
// underneath. Presentational: the host derives mood/blurb and owns the chat session; this only
// lays the column out.
//
// Resting, the identity block sits centred under the full-size face. Once the chat has taken the
// column (conversing, or a full-height pane like chat history — see `chatFills`), the face
// collapses to DaemonFace's own `compact` one-line-header form and the identity shrinks to just
// the name, riding beside it — the blurb and `[ edit ]` drop out, there's no room for them next
// to a one-line header and nothing productive they'd do there.
//
// Off (`enabled === false`): no identity, no chat — DaemonFace stays asleep and the caller
// (DaemonPage) is the one that decides what replaces this column's usual content.
import { Show, type JSX } from 'solid-js'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import EmptyState from '../ui/EmptyState'
import DaemonFace from './DaemonFace'
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

    const identity = () => (
        <Text
            as="span"
            size="inherit"
            tone="inherit"
            class={styles.identity}
            classList={{ [styles.identityCompact]: compact() }}
        >
            <Text as="span" size="ui" tone="default" class={styles.name}>
                {props.name}
            </Text>
            <Show when={!compact() && props.blurb}>
                <Text
                    as="span"
                    size="ui"
                    tone="muted"
                    class={styles.blurb}
                    data-testid="daemon-hub-blurb"
                >
                    {props.blurb}
                </Text>
            </Show>
            <Show when={!compact()}>
                <TextButton onClick={props.onEditIdentity} class={styles.edit}>
                    edit
                </TextButton>
            </Show>
        </Text>
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
