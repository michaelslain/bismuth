// app/src/chat/ChatHistoryRow.tsx
// One past conversation in the history panel: origin icon, title, relative time, and — for a
// search hit — the matching snippet under the title. It is `ui/PaletteRow`, the app's one
// selectable result row, so the keyboard cursor is `data-selected` here like everywhere else
// (this row used to carry its own `data-active` and stylesheet). The resume list and the search
// results render this same row, so the two can never drift into different geometries.
import type { Component } from 'solid-js'
import type { ChatOrigin } from '../api'
import { chatOriginIcon } from './chatOrigin'
import { relTimeChat } from '../relTime'
import PaletteRow from '../ui/PaletteRow'
import { snippetFromMatch } from './chatHistorySnippet'

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
    onClick: () => void
    class?: string
}

const ChatHistoryRow: Component<ChatHistoryRowProps> = props => (
    <PaletteRow
        id={props.id}
        selected={props.selected}
        icon={chatOriginIcon(props.origin)}
        label={props.summary?.trim() || 'Untitled session'}
        detail={props.snippet && snippetFromMatch(props.snippet, props.query ?? '')}
        sublabel={relTimeChat(props.lastModified)}
        onPick={() => props.onClick()}
        class={props.class}
    />
)

export default ChatHistoryRow
