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
import { settings } from '../settings'
import { matchesKeybinding } from '../keybindings'
import {
    CHAT_VISIBILITY_ROWS,
    checkedLevel,
    deleteAllLabel,
    deletedChatsMessage,
    effectiveNote,
    isDeleteKeyForRow,
    levelToWrite,
    visibilityMenuIcon,
} from './chatVisibility'
import { pushUndoToast } from '../undoToast'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import { IconButton } from '../ui/IconButton'
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

/** The slice of a list row or search hit the row menu reads. */
type MenuChat = {
    sessionId: string
    visibility?: 'chat-only' | 'hidden'
    ownVisibility?: 'all' | 'chat-only' | 'hidden'
}

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

    // ── Visibility + delete ──────────────────────────────────────────────────────────────────
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        flipFrom?: number
        items: MenuItem[]
    } | null>(null)

    const levelRows = (
        check: ReturnType<typeof checkedLevel>,
        pick: (level: (typeof CHAT_VISIBILITY_ROWS)[number]['value']) => void,
    ): MenuItem[] =>
        CHAT_VISIBILITY_ROWS.map(row => ({
            label: row.label,
            icon: check === row.value ? 'Check' : undefined,
            onSelect: () => pick(row.value),
        }))

    const rowMenu = (chat: MenuChat): MenuItem[] => {
        const def = props.history.defaultVisibility()
        const note = effectiveNote(chat.ownVisibility, def)
        return [
            {
                label: 'Visibility',
                icon: visibilityMenuIcon(chat.visibility),
                submenu: [
                    ...(note ? [{ label: note, disabled: true }] : []),
                    // Picking "Visible" goes through levelToWrite: it clears the chat's own level,
                    // except under a restricting default, where clearing would leave the chat hidden
                    // and only an explicit 'all' exposes it.
                    ...levelRows(checkedLevel(chat.ownVisibility, def), level =>
                        void props.history.setVisibility(
                            chat.sessionId,
                            levelToWrite(level, def),
                        ),
                    ),
                ],
            },
            {
                label: 'Delete chat',
                icon: 'Trash2',
                danger: true,
                separatorBefore: true,
                onSelect: () =>
                    void removeChats({ sessionIds: [chat.sessionId] }),
            },
        ]
    }
    const openRowMenu = (chat: MenuChat, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY, items: rowMenu(chat) })
    }

    const manageMenu = (): MenuItem[] => [
        {
            label: 'Default for all chats',
            icon: 'Eye',
            submenu: levelRows(props.history.defaultVisibility(), level =>
                void props.history.setDefaultVisibility(level),
            ),
        },
        {
            label: deleteAllLabel(props.history.scope()),
            icon: 'Trash2',
            danger: true,
            separatorBefore: true,
            disabled: props.history.sessions().length === 0,
            onSelect: () =>
                void removeChats({ scope: props.history.scope() }),
        },
    ]
    const openManageMenu = (e: MouseEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setMenu({
            x: r.left,
            y: r.bottom + 2,
            flipFrom: r.top,
            items: manageMenu(),
        })
    }

    /** The title a row shows, for the undo toast. */
    const titleOf = (id: string) =>
        [...props.history.sessions(), ...props.history.searchHits()].find(
            s => s.sessionId === id,
        )?.summary
    /** Delete at once, then offer the undo (every delete in the app): the toast puts the chats back
     *  from the server's trash. */
    const removeChats = async (
        target: { sessionIds: string[] } | { scope: ChatScope },
    ) => {
        const title = 'sessionIds' in target ? titleOf(target.sessionIds[0]!) : undefined
        const ids = await props.history.deleteChats(target)
        if (ids.length)
            pushUndoToast(deletedChatsMessage(ids.length, title), () =>
                props.history.restoreChats(ids),
            )
    }
    /** A row's hover `[x]`. */
    const deleteProps = (sessionId: string) => ({
        onDelete: () => void removeChats({ sessionIds: [sessionId] }),
    })

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
    // The delete chord deletes the cursor row. The cursor resets whenever the query changes, so a
    // live cursor means the user last used the arrows — Backspace while typing never reaches here.
    const onPromptKeyDown = (e: KeyboardEvent) => {
        if (
            isDeleteKeyForRow(
                matchesKeybinding(e, settings.keybindings['chat-history-delete']),
                nav.active(),
            )
        ) {
            const id = searching()
                ? props.history.searchHits()[nav.active()]?.sessionId
                : props.history.sessions()[nav.active()]?.sessionId
            if (id) {
                e.preventDefault()
                void removeChats({ sessionIds: [id] })
                return
            }
        }
        nav.onKeyDown(e)
    }
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
    const manage = () => (
        <IconButton
            icon="Settings2"
            label="Manage chats"
            onClick={openManageMenu}
        />
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
                    onKeyDown={onPromptKeyDown}
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
                        {manage()}
                    </Show>
                </SearchBar>
                <Show when={narrow()}>
                    <div class={styles.subhead}>
                        {scope()}
                        <div class={styles.subtrail}>
                            {newChat()}
                            {manage()}
                        </div>
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
                                                        visibility={
                                                            s.visibility
                                                        }
                                                        selected={
                                                            nav.active() === i
                                                        }
                                                        onClick={() =>
                                                            resumeAt(i)
                                                        }
                                                        onContextMenu={e =>
                                                            openRowMenu(s, e)
                                                        }
                                                        {...deleteProps(
                                                            s.sessionId,
                                                        )}
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
                                            visibility={hit.visibility}
                                            selected={nav.active() === i()}
                                            onClick={() => resumeAt(i())}
                                            onContextMenu={e =>
                                                openRowMenu(hit, e)
                                            }
                                            {...deleteProps(hit.sessionId)}
                                        />
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </Show>
            </div>
            <Show when={menu()}>
                {m => (
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        flipFrom={m().flipFrom}
                        items={m().items}
                        onClose={() => setMenu(null)}
                    />
                )}
            </Show>
        </div>
    )
}

export default ChatHistoryPanel
