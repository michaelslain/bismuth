// app/src/editor/TaskCheckbox.tsx
//
// The task-list checkbox rendered inside the live-preview editor. A small Solid
// component (mounted into a CodeMirror widget by livePreview.ts) so it stays
// consistent with the rest of the app — JSX, the shared Icon set, reactive state
// for smooth in-place transitions instead of hand-built innerHTML.
import { type Accessor } from "solid-js";
import { Icon } from "../icons/Icon";

// Status comes from the char between the brackets: space=todo, x/X=done,
// "/" or "\"=in-progress, "-"=cancelled. done + cancelled strike the text.
export type TaskStatus = "todo" | "done" | "doing" | "cancelled";

export function charToStatus(ch: string): TaskStatus {
  if (ch === "x" || ch === "X") return "done";
  if (ch === "/" || ch === "\\") return "doing";
  if (ch === "-") return "cancelled";
  return "todo";
}

/**
 * All three glyph layers are always present (each absolutely centered); the theme
 * fades in the one matching `data-status`. Keeping them mounted lets the status
 * cross-fade smoothly when `data-status` flips (driven by the widget's signal).
 */
export function TaskCheckbox(props: { status: Accessor<TaskStatus> }) {
  return (
    <span class="cm-task-checkbox" data-status={props.status()}>
      <span class="cm-ck-glyph cm-ck-check">
        <Icon value="Check" size={12} strokeWidth={3} />
      </span>
      <span class="cm-ck-glyph cm-ck-slash" />
      <span class="cm-ck-glyph cm-ck-dash" />
    </span>
  );
}
