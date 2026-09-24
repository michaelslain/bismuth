// app/src/chat/ChatHistoryPanel.tsx
// The session-history popover body — moved out of ChatView.tsx's inline `HistoryPanel()` (~2852-
//3090) so it renders from a `ChatHistoryState` (the reactive slice ChatSession.history exposes)
// instead of nine loose ChatView signals. The ANCHOR (positioning + the toggle button) stays in
// ChatControls.tsx, which owns "where does this popover attach"; this file owns only the body:
// the content search box, the user/daemon/all scope filter, and the resume list / search hits.
import { createMemo, For, onCleanup, onMount, Show } from 'solid-js'
import styles from './ChatHistoryPanel.module.css'
import type { ChatHistoryState } from './chatSession'
import type { ChatScope } from '../api'
import { relativeTime } from './chatRelativeTime'
import { chatOriginIcon } from '../chatOrigin'
import Text from '../ui/Text'
import { SegmentedToggle, type SegmentedOption } from '../ui/SegmentedToggle'
import { TextButton } from '../ui/TextButton'
import PopoverList, { type PopoverRow } from '../ui/popover/PopoverList'
import { Icon } from '../icons/Icon'
import PlainButton from '../ui/PlainButton'
import IconButton from '../ui/IconButton'
import SearchBar from '../ui/SearchBar'
import { isDismissKey } from '../ui/widgetKeys'

export type ChatHistoryPanelProps = {
    history: ChatHistoryState
    onNewChat?: () => void
    class?: string
}

const SCOPE_OPTIONS: SegmentedOption<ChatScope>[] = [
    { id: 'user', label: 'you', title: 'Chats you started' },
    {
        id: 'daemon',
        label: 'daemon',
        title: "Chats the daemon's crons started (dream, vault-review)",
    },
    { id: 'all', label: 'all', title: "Both, with the daemon's marked" },
]

export default function ChatHistoryPanel(props: ChatHistoryPanelProps) {
    // Read `props.history` at each use below, never bind it to a local — this is a Solid
    // component, and `const history = props.history` would read the prop ONCE at setup and keep
    // that ChatHistoryState forever even if a later render handed the panel a different one.

    const rows = createMemo<PopoverRow[]>(() =>
        props.history.sessions().map(s => ({
            label: s.summary?.trim() || 'Untitled session',
            icon: chatOriginIcon(s.origin),
            detail: relativeTime(s.lastModified),
        })),
    )
    const searching = () => props.history.query().trim().length > 0
    const emptyText = () =>
        props.history.scope() === 'daemon'
            ? 'No daemon conversations yet.'
            : props.history.scope() === 'all'
              ? 'No conversations yet.'
              : 'No past conversations yet.'

    const onDocKey = (e: KeyboardEvent) => {
        if (isDismissKey(e)) props.history.close()
    }
    onMount(() => {
        document.addEventListener('keydown', onDocKey, true)
    })
    onCleanup(() => {
        document.removeEventListener('keydown', onDocKey, true)
    })

    return (
        <div class={`${styles.panel} bismuth-popover ${props.class ?? ''}`}>
            <SearchBar
                class={styles.search}
                size="default"
                value={props.history.query()}
                onInput={props.history.setQuery}
                placeholder="conversations"
                autofocus
            >
                <IconButton
                    class={styles.close}
                    icon="X"
                    label="Close history"
                    onClick={props.history.close}
                />
            </SearchBar>
            <div class={styles.scope}>
                <SegmentedToggle
                    class={styles['scope-toggle']}
                    options={SCOPE_OPTIONS}
                    value={props.history.scope()}
                    onChange={props.history.setScope}
                    size="sm"
                />
            </div>
            {/* No header while searching — the query line IS the header, and a "Results" label
                over its own hits only restated it. */}
            <Show when={!searching()}>
                <div class={styles.title}>
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                    >
                        Resume a conversation
                    </Text>
                    <Show when={props.onNewChat}>
                        {onNewChat => (
                            <TextButton onClick={() => onNewChat()()}>
                                new chat
                            </TextButton>
                        )}
                    </Show>
                </div>
            </Show>
            <Show
                when={searching()}
                fallback={
                    <Show
                        when={!props.history.loading()}
                        fallback={<div class={styles.state}>Loading…</div>}
                    >
                        <Show
                            when={props.history.sessions().length > 0}
                            fallback={
                                <div class={styles.state}>{emptyText()}</div>
                            }
                        >
                            <div class={styles.scroll}>
                                <PopoverList
                                    class={styles.list}
                                    items={rows()}
                                    onActivate={i => {
                                        const s = props.history.sessions()[i]
                                        if (s) void props.history.resume(s.sessionId)
                                    }}
                                />
                            </div>
                        </Show>
                    </Show>
                }
            >
                <Show
                    when={!props.history.searchLoading()}
                    fallback={<div class={styles.state}>Searching…</div>}
                >
                    <Show
                        when={props.history.searchHits().length > 0}
                        fallback={
                            <div class={styles.state}>
                                No conversations match that search.
                            </div>
                        }
                    >
                        <div class={styles.scroll}>
                            <div class={styles.hits}>
                                <For each={props.history.searchHits()}>
                                    {hit => (
                                        <PlainButton
                                            class={styles.hit}
                                            onClick={() =>
                                                void props.history.resume(hit.sessionId)
                                            }
                                        >
                                            <div class={styles['hit-head']}>
                                                <Icon
                                                    value={chatOriginIcon(
                                                        hit.origin,
                                                    )}
                                                    class={styles['hit-icon']}
                                                />
                                                <Text
                                                    as="span"
                                                    class={styles['hit-title']}
                                                >
                                                    {hit.summary?.trim() ||
                                                        'Untitled session'}
                                                </Text>
                                                <Text
                                                    as="span"
                                                    class={styles['hit-time']}
                                                >
                                                    {relativeTime(
                                                        hit.lastModified,
                                                    )}
                                                </Text>
                                            </div>
                                            <div class={styles['hit-snippet']}>
                                                {hit.snippet}
                                            </div>
                                        </PlainButton>
                                    )}
                                </For>
                            </div>
                        </div>
                    </Show>
                </Show>
            </Show>
        </div>
    )
}
