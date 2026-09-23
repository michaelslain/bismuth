// app/src/daemon/DaemonMemory.tsx
// The daemon page's memory panel: a search field over the vault's `mem:` items, recent first (the
// host sorts — this only renders what it's given), each a <MemoryRow>. Presentational, like
// DaemonInbox/DaemonServices/DaemonLog beside it — no `api`/`pushToast`/store import here. The
// host debounces `onQuery` and re-fetches; this component owns only which row (if any) has its
// forget confirm armed, and the in-flight state of the one being forgotten.
import { createSignal, For, Show } from 'solid-js'
import SearchBar from '../ui/SearchBar'
import EmptyState, { Loading } from '../ui/EmptyState'
import DaemonPanel, { daemonPanelEmptyClass } from './DaemonPanel'
import MemoryRow from './MemoryRow'
import { memoryEmptyMessage } from './memoryListModel'
import styles from './DaemonMemory.module.css'

// Declared here (structurally identical to core's DaemonMemoryItem, core/src/daemonGraph.ts) so
// this task compiles without Task 1 — see the plan's Task 5 Interfaces block. MemoryRow.tsx
// imports this type rather than redeclaring it.
export type MemoryListItem = {
    path: string
    name: string
    type: string
    updated: string
    excerpt: string
}

export type DaemonMemoryProps = {
    items: MemoryListItem[]
    query: string
    /** The host debounces and fetches; this only reports keystrokes. */
    onQuery: (q: string) => void
    loading?: boolean
    onOpen: (path: string) => void
    onForget: (path: string) => Promise<void>
    class?: string
}

function DaemonMemory(props: DaemonMemoryProps) {
    // Only one row confirms at a time; arming a second row's forget silently disarms the first —
    // the same shape as DaemonServices' one-context-menu-at-a-time.
    const [confirmingPath, setConfirmingPath] = createSignal<string | null>(
        null,
    )
    const [forgetting, setForgetting] = createSignal<string | null>(null)

    async function confirmForget(path: string): Promise<void> {
        if (forgetting()) return
        setForgetting(path)
        try {
            await props.onForget(path)
        } finally {
            setForgetting(null)
            setConfirmingPath(null)
        }
    }

    const emptyMessage = () =>
        memoryEmptyMessage(props.query, props.items.length)

    return (
        <DaemonPanel class={props.class}>
            <SearchBar
                value={props.query}
                onInput={props.onQuery}
                placeholder="search memory"
                aria-label="search memory"
                class={styles['memory-search']}
            />
            <Show when={!props.loading} fallback={<Loading />}>
                <Show
                    when={!emptyMessage()}
                    fallback={
                        <EmptyState blockClass={daemonPanelEmptyClass}>
                            {emptyMessage()}
                        </EmptyState>
                    }
                >
                    <For each={props.items}>
                        {item => (
                            <MemoryRow
                                item={item}
                                confirming={confirmingPath() === item.path}
                                onOpen={() => props.onOpen(item.path)}
                                onForget={() => setConfirmingPath(item.path)}
                                onCancel={() => setConfirmingPath(null)}
                                onConfirm={() => void confirmForget(item.path)}
                            />
                        )}
                    </For>
                </Show>
            </Show>
        </DaemonPanel>
    )
}

export default DaemonMemory
