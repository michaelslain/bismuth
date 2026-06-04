// app/src/ui/StatusDot.tsx
// Colored-dot + word status (no pill): the canonical status renderer. The category
// palette (Reading=teal / To Read=blue / Finished=green / Abandoned=rose) lives here
// so Table/List/Kanban — and any future status display — stay in sync.
import "./ui.css";

export const STATUS_COLOR: Record<string, string> = {
  reading: "var(--teal)",
  "to read": "var(--blue)",
  toread: "var(--blue)",
  finished: "var(--green)",
  done: "var(--green)",
  complete: "var(--green)",
  abandoned: "var(--rose)",
  dropped: "var(--rose)",
};

/** Resolve a status string to its category color (faint fallback). Exported for reuse. */
export function statusColor(s: string): string {
  return STATUS_COLOR[s.trim().toLowerCase()] ?? "var(--faint)";
}

/** Just the dot, in a given color (e.g. List/Kanban group headers). */
export function StatusDot(props: { color?: string; status?: string }) {
  return <span class="status-dot" style={{ background: props.color ?? (props.status ? statusColor(props.status) : "var(--faint)") }} />;
}

/** Dot + label, both tinted to the status color. */
export function StatusText(props: { status: string }) {
  return (
    <span class="status-text" style={{ color: statusColor(props.status) }}>
      <span class="status-dot" />
      {props.status}
    </span>
  );
}
