// Shared task-status right-click menu: the option set + an imperative opener, used by both
// the cards view (BodyCard) and the note editor (livePreview's CodeMirror checkbox widget).
// `char` is the box char written between the brackets; the CURRENT status is filtered out so
// the menu only ever offers the OTHER modes (per the spec).
import { render } from "solid-js/web";
import { ContextMenu, type MenuItem } from "./ContextMenu";

export interface TaskStatusOption { char: string; label: string; icon: string }

export const TASK_STATUS_OPTIONS: TaskStatusOption[] = [
  { char: " ", label: "To do", icon: "Square" },
  { char: "/", label: "In progress", icon: "SquareSlash" },
  { char: "x", label: "Done", icon: "SquareCheck" },
  { char: "-", label: "Cancelled", icon: "SquareX" },
];

/** True if option `optChar` is the task's current status (so it should be hidden from the menu).
 *  Folds the case/alias variants: `x`/`X` (done), `/`/`\` (in progress). */
export function isCurrentStatus(optChar: string, cur: string): boolean {
  if (optChar === "x") return cur === "x" || cur === "X";
  if (optChar === "/") return cur === "/" || cur === "\\";
  return optChar === cur;
}

/** The menu items for a task whose current box char is `cur`, each invoking `onPick(char)`. */
export function taskStatusItems(cur: string, onPick: (char: string) => void): MenuItem[] {
  return TASK_STATUS_OPTIONS.filter((o) => !isCurrentStatus(o.char, cur)).map((o) => ({
    label: o.label,
    icon: o.icon,
    onSelect: () => onPick(o.char),
  }));
}

/**
 * Imperatively mount the shared <ContextMenu> at (x, y) for picking a task status — for callers
 * OUTSIDE Solid's reactive tree (the CodeMirror editor). Solid components inside the tree
 * (BodyCard) render <ContextMenu> directly instead. Self-disposing: closes on pick, Escape, or
 * outside-click, then removes its host node.
 */
export function openTaskStatusMenu(x: number, y: number, cur: string, onPick: (char: string) => void): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let dispose = () => {};
  const close = () => { dispose(); host.remove(); };
  dispose = render(() => ContextMenu({ x, y, items: taskStatusItems(cur, onPick), onClose: close }), host);
}
