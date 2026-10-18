// app/src/chat/ChatHistoryRow.tsx
// One past conversation in the history panel: origin icon, title, relative time, and — for a
// search hit — the matching snippet under the title. It is `ui/PaletteRow`, the app's one
// selectable result row, so the keyboard cursor is `data-selected` here like everywhere else
// (this row used to carry its own `data-active` and stylesheet). The resume list and the search
// results render this same row, so the two can never drift into different geometries. Hovering a
// row (or arrowing to it) shows an `[x]` at its far edge that deletes the chat at once; the panel's
// undo toast brings it back.
import { Show, type Component } from 'solid-js'
import type { ChatOrigin } from '../api'
import { chatOriginIcon } from './chatOrigin'
import { relTimeChat } from '../relTime'
import PaletteRow from '../ui/PaletteRow'
import VisibilityBadge from '../VisibilityBadge'
import { snippetFromMatch } from './chatHistorySnippet'
import CloseButton from '../ui/CloseButton'

export type ChatHistoryRowProps = {
    summary?: string
    lastModified: number
    origin?: ChatOrigin
    /** A search hit's matching excerpt; omitted for a plain resume-list row. */
    snippet?: string
    /** The search query behind `snippet`. The excerpt shows on one ellipsised line, so it is
     *  re-windowed to START near the match — otherwise the matching term (centered in the excerpt)
     *  is the part the ellipsis cuts. */
    query?: string
    /** The keyboard-highlighted row (the panel's arrow-key cursor). */
    selected?: boolean
    /** DOM id, so the panel's listbox can name the cursor row with `aria-activedescendant`. */
    id?: string
    /** The RESOLVED visibility (own level, else the chat default); omitted when it is `all`. */
    visibility?: 'chat-only' | 'hidden'
    onClick: () => void
    /** Right-click: the panel opens the row's visibility/delete menu. */
    onContextMenu?: (e: MouseEvent) => void
    /** The hover `[x]`: deletes this chat at once (the panel offers the undo). Omitted → no `[x]`. */
    onDelete?: () => void
    class?: string
}

const ChatHistoryRow: Component<ChatHistoryRowProps> = props => (
    <PaletteRow
        id={props.id}
        selected={props.selected}
        icon={chatOriginIcon(props.origin)}
        label={props.summary?.trim() || 'Untitled session'}
        detail={props.snippet && snippetFromMatch(props.snippet, props.query ?? '')}
        // Always passed, even when empty: the row reserves the badge slot so the time column
        // lines up between restricted and open chats.
        // Always passed, even when empty: the row reserves the badge slot so the time column
        // lines up between restricted and open chats.
        badge={<VisibilityBadge visibility={props.visibility} />}
        sublabel={relTimeChat(props.lastModified)}
        onPick={() => props.onClick()}
        onContextMenu={e => props.onContextMenu?.(e)}
        actions={
            <Show when={props.onDelete}>
                {onDelete => (
                    // The plain `[x]` in full ink: it shows on one hovered or selected row at a time.
                    <CloseButton label="delete chat" onClick={() => onDelete()()} />
                )}
            </Show>
        }
        class={props.class}
    />
)

export default ChatHistoryRow
