// app/src/preview/BookmarksPanel.tsx
// The PDF preview's right-hand navigation column, styled like the file tree: bookmarks (the
// user's own page marks, stored in the binary's `.draw` sidecar through the annotation store; the
// list is BookmarkList, the same one a book's panel shows) above outline (the document's embedded table of contents, resolved by PdfPages' `onOutline`).
// Every bookmark edit goes through `store.edit` with the pure ops in
// core/src/drawing/pageBookmarks.ts, so it shares the sidecar's one debounce and one undo stack
// with ink and highlights.
import { createMemo, Show } from 'solid-js'
import {
    addBookmark,
    removeBookmark,
    renameBookmark,
    sortedBookmarks,
} from '../../../core/src/drawing/pageBookmarks'
import type { AnnotationStore, OutlineNode } from './annotationTypes'
import BookmarkList from './BookmarkList'
import OutlineTree from './OutlineTree'
import { currentOutlinePath, outlineTitleForPage } from './outlineCurrent'
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
    // The outline node the reader's current page falls under — OutlineTree's "you are here"
    // marker, and the default label a fresh bookmark borrows before falling back to `Page N`.
    const currentPath = createMemo(() =>
        currentOutlinePath(props.outline(), props.currentPage()),
    )

    return (
        <div
            class={[styles['bookmarks-panel'], props.class]
                .filter(Boolean)
                .join(' ')}
        >
            <BookmarkList
                bookmarks={bookmarks()}
                ready={ready()}
                onAdd={() =>
                    props.store.edit(d =>
                        addBookmark(
                            d,
                            props.currentPage(),
                            outlineTitleForPage(props.outline(), props.currentPage()) ?? undefined,
                        ),
                    )
                }
                onJump={props.onJump}
                onRename={(id, label) => props.store.edit(d => renameBookmark(d, id, label))}
                onRemove={id => props.store.edit(d => removeBookmark(d, id))}
            />
            <section class={styles['bookmarks-section']} aria-label="Outline">
                <div class={styles['bookmarks-head']}>
                    <Text as="span" size="micro" tone="muted" eyebrow>
                        outline
                    </Text>
                </div>
                <Show
                    when={props.outline().length > 0}
                    fallback={
                        <Text
                            size="ui"
                            tone="muted"
                            class={styles['bookmarks-empty']}
                        >
                            This document has no outline.
                        </Text>
                    }
                >
                    <OutlineTree
                        nodes={props.outline()}
                        onJump={props.onJump}
                        currentPath={currentPath()}
                    />
                </Show>
            </section>
        </div>
    )
}

export default BookmarksPanel
