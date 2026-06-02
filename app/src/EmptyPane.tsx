// app/src/EmptyPane.tsx
// Placeholder shown when a pane has no content yet. The user fills it by dragging
// a file in, clicking "Open file…" (quick switcher), or "New terminal".
import { Icon } from "./icons/Icon";
import { TextButton } from "./ui/TextButton";

type Props = {
  onOpenFile: () => void;
  onNewTerminal: () => void;
};

export function EmptyPane(props: Props) {
  return (
    <div class="empty">
      <div class="ehint">
        <div class="empty-title">Empty pane</div>
        <div class="kbd"><b>⌘O</b> quick switch <b>⌘P</b> commands <b>⌘N</b> new note</div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <TextButton
          onClick={props.onOpenFile}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Icon value="FolderOpen" size={14} /> OPEN FILE…
        </TextButton>
        <TextButton
          onClick={props.onNewTerminal}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Icon value="SquareTerminal" size={14} /> NEW TERMINAL
        </TextButton>
      </div>
    </div>
  );
}
