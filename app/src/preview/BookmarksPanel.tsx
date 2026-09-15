// app/src/preview/BookmarksPanel.tsx
// The PDF preview's right-hand navigation column, styled like the file tree: BOOKMARKS (the
// user's own page marks, stored in the binary's `.draw` sidecar through the annotation store)
// above OUTLINE (the document's embedded table of contents, resolved by PdfPages' `onOutline`).
// Every bookmark edit goes through `store.edit` with the pure ops in
// core/src/drawing/pageBookmarks.ts, so it shares the sidecar's one debounce and one undo stack
// with ink and highlights.
import { createMemo, For, Show } from 'solid-js'
import {
    addBookmark,
    removeBookmark,
    renameBookmark,
    sortedBookmarks,
} from '../../../core/src/drawing/pageBookmarks'
import type { AnnotationStore, OutlineNode } from './annotationTypes'
import BookmarkRow from './BookmarkRow'
import OutlineTree from './OutlineTree'
import IconButton from '../ui/IconButton'
import Text from '../ui/Text'
import styles from './BookmarksPanel.module.css'

export type BookmarksPanelProps = {
    store: AnnotationStore
    outline: () => OutlineNode[]
    currentPage: () => number
    onJump: (page: number) => void
    class?: string
}

function BookmarksPanel(props: BookmarksPanelProps) {
    const bookmarks = createMemo(() => sortedBookmarks(props.store.doc()))
    const ready = () => props.store.loadState() === 'ready'

    return (
        <div
            class={[styles['bookmarks-panel'], props.class]
                .filter(Boolean)
                .join(' ')}
        >
            <section class={styles['bookmarks-section']} aria-label="Bookmarks">
                <div class={styles['bookmarks-head']}>
                    <Text as="span" size="micro" tone="muted" eyebrow>
                        BOOKMARKS
                    </Text>
                    <IconButton
                        icon="Plus"
                        label="Bookmark this page"
                        size="sm"
                        disabled={!ready()}
                        onClick={() =>
                            props.store.edit(d =>
                                addBookmark(d, props.currentPage()),
                            )
                        }
                    />
                </div>
                <Show
                    when={bookmarks().length > 0}
                    fallback={
                        <Text
                            size="ui"
                            tone="faint"
                            class={styles['bookmarks-empty']}
                        >
                            No bookmarks yet.
                        </Text>
                    }
                >
                    <div role="list">
                        <For each={bookmarks()}>
                            {(b, i) => (
                                <BookmarkRow
                                    bookmark={b}
                                    last={i() === bookmarks().length - 1}
                                    onJump={props.onJump}
                                    onRename={(id, label) =>
                                        props.store.edit(d =>
                                            renameBookmark(d, id, label),
                                        )
                                    }
                                    onRemove={id =>
                                        props.store.edit(d =>
                                            removeBookmark(d, id),
                                        )
                                    }
                                />
                            )}
                        </For>
                    </div>
                </Show>
            </section>
            <section class={styles['bookmarks-section']} aria-label="Outline">
                <div class={styles['bookmarks-head']}>
                    <Text as="span" size="micro" tone="muted" eyebrow>
                        OUTLINE
                    </Text>
                </div>
                <Show
                    when={props.outline().length > 0}
                    fallback={
                        <Text
                            size="ui"
                            tone="faint"
                            class={styles['bookmarks-empty']}
                        >
                            This document has no outline.
                        </Text>
                    }
                >
                    <OutlineTree
                        nodes={props.outline()}
                        onJump={props.onJump}
                    />
                </Show>
            </section>
        </div>
    )
}

export default BookmarksPanel
