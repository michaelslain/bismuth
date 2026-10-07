// app/src/chat/ChatHistoryPanel.tsx
// The session-history pane body, rendered from a `ChatHistoryState` (the reactive slice
// ChatSession.history exposes). The ANCHOR (the toggle button and where the pane mounts) stays in
// ChatControls.tsx, and the dialog shell around it is ChatHistoryModal.tsx; this file owns only the
// body: ONE header line (the content search prompt with
// the you/daemon/all scope, new chat and close riding its trailing slot, so the prompt's underline
// is the header's only rule), then the resume list grouped by age, or the search hits.
//
// Narrow hosts (the column-mode chat, ~260–360px) cannot fit the scope and new chat beside the
// prompt without crushing the input, so below NARROW_PX they drop to a second line under it. That
// is a measured width, not a container query, because the controls change PARENT (SearchBar's
// trailing slot vs the line below) — CSS can restyle a node but not move it.
import {
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onCleanup,
    onMount,
    Show,
    type Component,
} from 'solid-js'
import styles from './ChatHistoryPanel.module.css'
import type { ChatHistoryState } from './chatSession'
import type { ChatScope } from '../api'
import { groupByAge } from './chatHistoryGroups'
import ChatHistoryRow from './ChatHistoryRow'
import Text from '../ui/Text'
import { SegmentedToggle, type SegmentedOption } from '../ui/SegmentedToggle'
import { TextButton } from '../ui/TextButton'
import SectionLabel from '../ui/SectionLabel'
import EmptyState from '../ui/EmptyState'
import SearchBar from '../ui/SearchBar'
import { createMenuNav } from '../ui/popover/createMenuNav'

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

/** Below this panel width the scope + new chat leave the prompt line for a line of their own. */
const NARROW_PX = 480

const ChatHistoryPanel: Component<ChatHistoryPanelProps> = props => {
    // Read `props.history` at each use below, never bind it to a local — this is a Solid
    // component, and `const history = props.history` would read the prop ONCE at setup and keep
    // that ChatHistoryState forever even if a later render handed the panel a different one.

    const searching = () => props.history.query().trim().length > 0
    const emptyText = () =>
        props.history.scope() === 'daemon'
            ? 'No daemon conversations yet.'
            : props.history.scope() === 'all'
              ? 'No conversations yet.'
              : 'No past conversations yet.'

    // Each session keeps its index into sessions() through the grouping, so the arrow-key cursor
    // (one flat index) and the grouped render agree on which row is which.
    const groups = createMemo(() =>
        groupByAge(
            props.history.sessions().map((s, i) => ({ s, i })),
            x => x.s.lastModified,
            Date.now(),
        ),
    )
    const rowCount = () =>
        searching()
            ? props.history.searchHits().length
            : props.history.sessions().length
    const resumeAt = (i: number) => {
        const id = searching()
            ? props.history.searchHits()[i]?.sessionId
            : props.history.sessions()[i]?.sessionId
        if (id) void props.history.resume(id)
    }

    // Up/Down from the search prompt walk the rows, Enter resumes. No row is highlighted until an
    // arrow is pressed — a resting list with its first row lit reads as "already chosen".
    // Escape in the prompt closes through the nav: it preventDefaults the key, so the surrounding
    // Modal's own dismiss handler then stands down and the dialog closes exactly once.
    const nav = createMenuNav({
        count: rowCount,
        onSelect: resumeAt,
        onEscape: () => props.history.close(),
    })
    createEffect(
        on([props.history.query, props.history.scope, rowCount], () =>
            nav.setActive(-1),
        ),
    )
    // The cursor row is found by its `data-selected` hook (PaletteRow's), not a ref per row.
    createEffect(() => {
        if (nav.active() < 0) return
        root
            .querySelector<HTMLElement>('[data-selected]')
            ?.scrollIntoView({ block: 'nearest' })
    })

    let root!: HTMLDivElement
    const [narrow, setNarrow] = createSignal(false)
    onMount(() => {
        const measure = () => setNarrow(root.clientWidth < NARROW_PX)
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(root)
        onCleanup(() => ro.disconnect())
    })

    const scope = () => (
        <SegmentedToggle
            options={SCOPE_OPTIONS}
            value={props.history.scope()}
            onChange={props.history.setScope}
            size="sm"
        />
    )
    const newChat = () => (
        <Show when={props.onNewChat}>
            {onNewChat => (
                <TextButton onClick={() => onNewChat()()}>new chat</TextButton>
            )}
        </Show>
    )
    const state = (text: string) => (
        <EmptyState compact class={styles.state}>
            {text}
        </EmptyState>
    )

    return (
        <div
            ref={root}
            class={`${styles.panel} ${props.class ?? ''}`}
            data-narrow={narrow() ? '' : undefined}
        >
            <div class={styles.head}>
                <SearchBar
                    size="default"
                    value={props.history.query()}
                    onInput={props.history.setQuery}
                    onKeyDown={nav.onKeyDown}
                    placeholder="conversations"
                    aria-label="Search conversations"
                    aria-activedescendant={
                        nav.active() >= 0
                            ? `chat-history-row-${nav.active()}`
                            : undefined
                    }
                    autofocus
                >
                    <Show when={!narrow()}>
                        {scope()}
                        {/* `//` splits the filter from the command, as in the chat controls row —
                            without it `[all] [new chat]` read as one bracket run. */}
                        <Show when={props.onNewChat}>
                            <Text
                                as="span"
                                size="ui"
                                tone="faint"
                                aria-hidden="true"
                            >
                                //
                            </Text>
                        </Show>
                        {newChat()}
                    </Show>
                </SearchBar>
                <Show when={narrow()}>
                    <div class={styles.subhead}>
                        {scope()}
                        {newChat()}
                    </div>
                </Show>
            </div>
            <div class={styles.body} role="listbox" aria-label="Past conversations">
                <Show
                    when={searching()}
                    fallback={
                        <Show
                            when={!props.history.loading()}
                            fallback={state('Loading…')}
                        >
                            <Show
                                when={props.history.sessions().length > 0}
                                fallback={state(emptyText())}
                            >
                                <For each={groups()}>
                                    {group => (
                                        <div
                                            class={styles.group}
                                            role="group"
                                            aria-label={group.label}
                                        >
                                            <SectionLabel
                                                class={styles['group-label']}
                                            >
                                                {group.label}
                                            </SectionLabel>
                                            <For each={group.items}>
                                                {({ s, i }) => (
                                                    <ChatHistoryRow
                                                        id={`chat-history-row-${i}`}
                                                        summary={s.summary}
                                                        lastModified={
                                                            s.lastModified
                                                        }
                                                        origin={s.origin}
                                                        selected={
                                                            nav.active() === i
                                                        }
                                                        onClick={() =>
                                                            resumeAt(i)
                                                        }
                                                    />
                                                )}
                                            </For>
                                        </div>
                                    )}
                                </For>
                            </Show>
                        </Show>
                    }
                >
                    <Show
                        when={!props.history.searchLoading()}
                        fallback={state('Searching…')}
                    >
                        <Show
                            when={props.history.searchHits().length > 0}
                            fallback={state(
                                'No conversations match that search.',
                            )}
                        >
                            <div
                                class={styles.group}
                                role="group"
                                aria-label="Matches"
                            >
                                <SectionLabel class={styles['group-label']}>
                                    {props.history.searchHits().length === 1
                                        ? '1 match'
                                        : `${props.history.searchHits().length} matches`}
                                </SectionLabel>
                                <For each={props.history.searchHits()}>
                                    {(hit, i) => (
                                        <ChatHistoryRow
                                            id={`chat-history-row-${i()}`}
                                            summary={hit.summary}
                                            lastModified={hit.lastModified}
                                            origin={hit.origin}
                                            snippet={hit.snippet}
                                            query={props.history.query()}
                                            selected={nav.active() === i()}
                                            onClick={() => resumeAt(i())}
                                        />
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </Show>
            </div>
        </div>
    )
}

export default ChatHistoryPanel
