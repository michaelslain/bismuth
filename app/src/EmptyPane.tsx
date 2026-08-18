// app/src/EmptyPane.tsx
// Shown when a pane has no content yet. A single "new terminal" button (styled to
// match the sidebar toolbar icons) plus a faint hint that the pane is fillable by
// dragging or clicking a note. The pane's header title is left blank (see
// tabIds.contentLabel) so an empty pane reads as truly empty.
import { IconButton } from './ui/IconButton'

type Props = {
    onNewTerminal: () => void
}

export function EmptyPane(props: Props) {
    // `empty-pane`, not `empty`: a bare global `.empty` (display:flex, height:100%)
    // silently captured any other component's `empty` span — it was what broke the
    // flashcards progress meter onto three lines.
    return (
        <div class="empty-pane">
            <IconButton
                icon="SquareTerminal"
                label="New terminal"
                iconSize={18}
                onClick={props.onNewTerminal}
                onMouseDown={e => e.stopPropagation()}
            />
            <div class="empty-hint">
                drag a note here, or click one to open it
            </div>
        </div>
    )
}
