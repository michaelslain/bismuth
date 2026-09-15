// app/src/preview/BookmarkRow.tsx
// One user bookmark in the PDF bookmarks panel: a file-tree-style row — label, page number —
// that jumps to its page on click (or Enter), renames in place on double-click or the pencil
// (ui/InlineTextInput, the same input the file tree renames with), and deletes. Bookmarks are a
// flat, user-ordered list (sorted by page, not a hierarchy), so unlike OutlineTree this row draws
// no ASCII connector — a flat list wearing tree-branch glyphs was the thing the user rejected the
// look over. Presentational: the panel owns the store and hands down the three edits.
import { createSignal, Show } from 'solid-js'
import type { Bookmark } from '../../../core/src/drawing/model'
import IconButton from '../ui/IconButton'
import InlineTextInput from '../ui/InlineTextInput'
import Label from '../ui/Label'
import styles from './BookmarkRow.module.css'

export type BookmarkRowProps = {
    bookmark: Bookmark
    /** `store.loadState() === 'ready'` — `store.edit` (both `onRename`/`onRemove` go through it)
     *  is a no-op before this, so rename/delete are disabled rather than inert: a click that
     *  silently does nothing, with no snap-back, is a worse affordance than a disabled control
     *  (final review — docs/drawing/overview.md already claims edits stay disabled until ready;
     *  this row was the one place that wasn't true). Jump (click/Enter) never edits, so it stays
     *  enabled regardless. */
    ready: boolean
    onJump: (page: number) => void
    onRename: (id: string, label: string) => void
    onRemove: (id: string) => void
    class?: string
}

function BookmarkRow(props: BookmarkRowProps) {
    const [editing, setEditing] = createSignal(false)

    const commit = (label: string) => {
        setEditing(false)
        if (label && label !== props.bookmark.label) {
            props.onRename(props.bookmark.id, label)
        }
    }

    return (
        <div
            class={[styles['bookmark-row'], props.class]
                .filter(Boolean)
                .join(' ')}
            role="listitem"
            tabindex="0"
            aria-label={`Jump to ${props.bookmark.label}, page ${props.bookmark.page + 1}`}
            data-bookmark-id={props.bookmark.id}
            onClick={() => {
                if (!editing()) props.onJump(props.bookmark.page)
            }}
            onDblClick={() => {
                if (props.ready) setEditing(true)
            }}
            onKeyDown={e => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter') props.onJump(props.bookmark.page)
                else if (e.key === 'F2' && props.ready) setEditing(true)
            }}
        >
            <Show
                when={editing()}
                fallback={
                    <Label fill class={styles['bookmark-label']}>
                        {props.bookmark.label}
                    </Label>
                }
            >
                <InlineTextInput
                    value={props.bookmark.label}
                    label="Bookmark name"
                    class={styles['bookmark-input']}
                    onCommit={commit}
                    onCancel={() => setEditing(false)}
                />
            </Show>
            <Label tone="muted" class={styles['bookmark-page']}>
                {`p.${props.bookmark.page + 1}`}
            </Label>
            {/* The row's own gestures (jump on click, rename on double-click) must not fire from
                its trailing controls — this region declares every one of those events its own. */}
            <span
                class={styles['bookmark-actions']}
                onClick={e => e.stopPropagation()}
                onDblClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
            >
                <IconButton
                    icon="Pencil"
                    label="Rename bookmark"
                    disabled={!props.ready}
                    onClick={() => setEditing(true)}
                />
                <IconButton
                    icon="Trash2"
                    label="Delete bookmark"
                    disabled={!props.ready}
                    danger
                    onClick={() => props.onRemove(props.bookmark.id)}
                />
            </span>
        </div>
    )
}

export default BookmarkRow
