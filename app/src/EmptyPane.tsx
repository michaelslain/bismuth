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
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        gap: "12px",
        color: "var(--text-muted)",
        "user-select": "none",
      }}
    >
      <div style={{ "font-size": "15px", "font-weight": 600, opacity: 0.85 }}>
        Empty pane
      </div>
      <div style={{ "font-size": "13px", opacity: 0.6 }}>
        Drag a file here, or:
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <TextButton
          variant="ghost"
          class="empty-pane-btn"
          onClick={props.onOpenFile}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}
        >
          <Icon value="FolderOpen" size={14} /> Open file…
        </TextButton>
        <TextButton
          variant="ghost"
          class="empty-pane-btn"
          onClick={props.onNewTerminal}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}
        >
          <Icon value="SquareTerminal" size={14} /> New terminal
        </TextButton>
      </div>
    </div>
  );
}
