// app/src/InboxActionBar.tsx
// The action bar pinned to the bottom of an inbox page: status dot + phrase on the left, the
// page's actions as buttons on the right with the primary LAST. Stuck and not-owner warnings
// replace the phrase. Owns no signal and never fetches — the host passes everything in.
import { For, Show, type Component } from 'solid-js'
import type { DaemonPage } from '../../core/src/daemonPages'
import { STATUS_COLOR } from './daemon/daemonInboxLogic'
import { actionBarPhrase } from './inboxPageMeta'
import StatusDot from './ui/StatusDot'
import Text from './ui/Text'
import { TextButton } from './ui/TextButton'
import styles from './InboxActionBar.module.css'

export type InboxActionBarProps = {
    page: DaemonPage | undefined
    notOwner: boolean
    stuck: boolean
    pressingId: string | null
    onPress: (actionId: string) => void
    onMarkFailed: () => void
    class?: string
}

const NOT_OWNER_LIVE = "this device isn't the daemon owner — approving here won't fire"
const NOT_OWNER_STUCK =
    "this device isn't the daemon owner — the approval never fired. approve from the owner device"
const OFFLINE = 'no response — daemon may be offline'

const InboxActionBar: Component<InboxActionBarProps> = props => {
    // primary LAST, otherwise the page's own order
    const actions = (p: DaemonPage) =>
        [...p.actions].sort(
            (a, b) => Number(a.kind === 'primary') - Number(b.kind === 'primary'),
        )
    const live = (p: DaemonPage) => p.status === 'pending' || p.status === 'working'
    const showButtons = (p: DaemonPage) =>
        !props.stuck && (live(p) || p.status === 'failed')

    return (
        <div
            class={`${styles['inbox-action-bar']} ${props.class ?? ''}`}
            data-testid="inbox-page-actions"
        >
            <div class={styles.row}>
                <Show when={props.page} keyed>
                    {p => (
                        <>
                            <div class={styles.lead}>
                                <Show
                                    when={props.stuck}
                                    fallback={
                                        <Show
                                            when={props.notOwner && live(p)}
                                            fallback={
                                                <>
                                                    <StatusDot color={STATUS_COLOR[p.status]} />
                                                    <Text
                                                        as="span"
                                                        size="ui"
                                                        tone="muted"
                                                        class={styles.phrase}
                                                    >
                                                        {actionBarPhrase(p)}
                                                    </Text>
                                                </>
                                            }
                                        >
                                            <Text
                                                as="span"
                                                size="ui"
                                                tone="inherit"
                                                class={`${styles.phrase} ${styles.warn}`}
                                            >
                                                {NOT_OWNER_LIVE}
                                            </Text>
                                        </Show>
                                    }
                                >
                                    <Text
                                        as="span"
                                        size="ui"
                                        tone="inherit"
                                        class={`${styles.phrase} ${styles.warn}`}
                                    >
                                        {props.notOwner ? NOT_OWNER_STUCK : OFFLINE}
                                    </Text>
                                </Show>
                            </div>
                            <div class={styles.buttons}>
                                <Show when={props.stuck}>
                                    <TextButton onClick={props.onMarkFailed}>
                                        mark failed
                                    </TextButton>
                                </Show>
                                <Show when={showButtons(p)}>
                                    <For each={actions(p)}>
                                        {a => (
                                            <TextButton
                                                variant={
                                                    a.kind === 'primary' ? 'selected' : 'normal'
                                                }
                                                danger={a.kind === 'danger'}
                                                disabled={
                                                    p.status === 'working' ||
                                                    props.pressingId !== null
                                                }
                                                onClick={() => props.onPress(a.id)}
                                            >
                                                {p.status === 'working' &&
                                                props.pressingId === a.id
                                                    ? 'working…'
                                                    : a.label.toLowerCase()}
                                            </TextButton>
                                        )}
                                    </For>
                                </Show>
                            </div>
                        </>
                    )}
                </Show>
            </div>
        </div>
    )
}

export default InboxActionBar
