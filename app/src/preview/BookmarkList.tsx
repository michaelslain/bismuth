// app/src/preview/BookmarkList.tsx
// The bookmarks section of the reader, shared by the PDF preview's panel and a book's panel: a
// header with `+`, then one row per bookmark that jumps on click and renames or deletes on hover.
import { For, Show, type Component } from 'solid-js'
import type { Bookmark } from '../../../core/src/drawing/model'
import BookmarkRow from './BookmarkRow'
import IconButton from '../ui/IconButton'
import Text from '../ui/Text'
import styles from './BookmarkList.module.css'

export type BookmarkListProps = {
    /** In page order. `page` is the page a row shows as `p.N` and jumps to. */
    bookmarks: Bookmark[]
    /** Rename, remove and `+` work; false while the page's sidecar is still loading. */
    ready: boolean
    /** Bookmark the page on screen. */
    onAdd: () => void
    onJump: (page: number) => void
    onRename: (id: string, label: string) => void
    onRemove: (id: string) => void
    class?: string
}

const BookmarkList: Component<BookmarkListProps> = props => (
    <section class={[styles.section, props.class].filter(Boolean).join(' ')} aria-label="Bookmarks">
        <div class={styles.head}>
            <Text as="span" size="micro" tone="muted" eyebrow>
                bookmarks
            </Text>
            <IconButton icon="Plus" label="Bookmark this page" size="sm" disabled={!props.ready} onClick={() => props.onAdd()} />
        </div>
        <Show
            when={props.bookmarks.length > 0}
            fallback={
                <Text size="ui" tone="muted" class={styles.empty}>
                    No bookmarks yet.
                </Text>
            }
        >
            <div role="list">
                <For each={props.bookmarks}>
                    {b => (
                        <BookmarkRow
                            bookmark={b}
                            ready={props.ready}
                            onJump={props.onJump}
                            onRename={props.onRename}
                            onRemove={props.onRemove}
                        />
                    )}
                </For>
            </div>
        </Show>
    </section>
)

export default BookmarkList
