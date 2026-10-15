// app/src/InboxActionBar.tsx
// The end of an inbox page's transcript, right under the last message (no dock, no dead space):
// the page's buttons as bracket chips, then the `>` reply prompt. A failure note or a stuck /
// not-owner warning sits above the chips. A page that takes no reply right now (working, done,
// dismissed) ends instead with one status line: a dot and a phrase. Owns no fetch; the host passes
// everything in.
import { For, Show, type Component } from 'solid-js'
import type { DaemonPage } from '../../core/src/daemonPages'
import { STATUS_COLOR } from './daemon/daemonInboxLogic'
import {
    actionBarNote,
    actionBarPhrase,
    canReply,
    replyHint,
    replyPlaceholder,
} from './inboxPageMeta'
import InboxReplyField from './InboxReplyField'
import { settings } from './settings'
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
    /** Answer the page in words; the daemon reads it and presses or asks back. */
    onReply: (text: string) => void | Promise<void>
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
    const pressable = (p: DaemonPage) => canReply(p) && !props.stuck
    const composing = (p: DaemonPage) => pressable(p) && !props.notOwner
    const warning = (p: DaemonPage) =>
        props.stuck
            ? props.notOwner
                ? NOT_OWNER_STUCK
                : OFFLINE
            : props.notOwner && live(p)
              ? NOT_OWNER_LIVE
              : null

    return (
        <div
            class={`${styles['inbox-action-bar']} ${props.class ?? ''}`}
            data-testid="inbox-page-actions"
        >
            <Show when={props.page} keyed>
                {p => (
                    <>
                        <Show when={warning(p) ?? (props.stuck ? null : actionBarNote(p))}>
                            {note => (
                                <Text
                                    as="div"
                                    size="ui"
                                    tone={warning(p) ? 'warning' : 'danger'}
                                    data-testid="inbox-page-note"
                                >
                                    {note()}
                                </Text>
                            )}
                        </Show>
                        <Show when={pressable(p) || props.stuck}>
                            <div class={styles.chips}>
                                <Show
                                    when={!props.stuck}
                                    fallback={
                                        <TextButton onClick={props.onMarkFailed}>
                                            mark failed
                                        </TextButton>
                                    }
                                >
                                    <For each={actions(p)}>
                                        {a => (
                                            <TextButton
                                                variant={
                                                    a.kind === 'primary' ? 'selected' : 'normal'
                                                }
                                                danger={a.kind === 'danger'}
                                                disabled={props.pressingId !== null}
                                                onClick={() => props.onPress(a.id)}
                                            >
                                                {a.label.toLowerCase()}
                                            </TextButton>
                                        )}
                                    </For>
                                </Show>
                            </div>
                        </Show>
                        <Show
                            when={composing(p)}
                            fallback={
                                <Show when={!pressable(p) && !props.stuck}>
                                    <div class={styles.status} data-testid="inbox-page-status">
                                        <StatusDot color={STATUS_COLOR[p.status]} />
                                        <Text
                                            as="span"
                                            size="ui"
                                            tone="muted"
                                            class={styles.phrase}
                                        >
                                            {actionBarPhrase(p)}
                                        </Text>
                                    </div>
                                </Show>
                            }
                        >
                            <InboxReplyField
                                placeholder={replyPlaceholder(p)}
                                hint={replyHint(settings.keybindings['ui-confirm'])}
                                disabled={props.pressingId !== null}
                                onSubmit={props.onReply}
                            />
                        </Show>
                    </>
                )}
            </Show>
        </div>
    )
}

export default InboxActionBar
