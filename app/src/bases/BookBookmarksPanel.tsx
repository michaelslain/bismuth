import type { Component } from 'solid-js'
import type { Bookmark } from '../../../core/src/drawing/model'
import BookmarkList from '../preview/BookmarkList'
import styles from './BookBookmarksPanel.module.css'

export type BookBookmarksPanelProps = {
    /** Every bookmark in the book, in page order. `page` is the BOOK page (0-based), which is
     *  what a row shows as `p.N` and jumps to; `label` defaults to `Page N`. */
    bookmarks: Bookmark[]
    /** Rename, remove and `+` work; false while the current page's sidecar is still loading. */
    ready: boolean
    /** Bookmark the page on screen. */
    onAdd: () => void
    onJump: (page: number) => void
    onRename: (id: string, label: string) => void
    onRemove: (id: string) => void
    className?: string
}

/** The right-hand bookmarks column of a book: the reader's `BookmarkList` (the same list the PDF
 *  preview's panel shows) in a column beside the pages. */
const BookBookmarksPanel: Component<BookBookmarksPanelProps> = props => (
    <div class={[styles.panel, props.className].filter(Boolean).join(' ')} data-book-bookmarks>
        <BookmarkList
            bookmarks={props.bookmarks}
            ready={props.ready}
            onAdd={props.onAdd}
            onJump={props.onJump}
            onRename={props.onRename}
            onRemove={props.onRemove}
        />
    </div>
)

export default BookBookmarksPanel
