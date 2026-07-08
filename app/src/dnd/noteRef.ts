// app/src/dnd/noteRef.ts
// Pure helpers shared by the drag-drop drop handlers (Row 74): turning a dragged
// note path into a wikilink / chat reference, and reading the note path back off a
// DragDescriptor regardless of whether the drag started from the sidebar or a tab/pane.
// Kept dependency-light (only the DragDescriptor type) so it's unit-testable headlessly.
import type { DragDescriptor } from "./viewDrag";

/** True for a markdown note path (the only thing a `[[wikilink]]` / chat mention makes sense for). */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** The wikilink-visible name of a note path: its basename with the markdown extension stripped
 *  (wikilinks resolve by filename, not path — `Projects/Gamma.md` → `Gamma`). */
export function noteNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(md|markdown)$/i, "");
}

/** `[[Name]]` for a note path — inserted into an editor (drop-to-link) or a chat draft (drop-to-mention). */
export function wikilinkFor(path: string): string {
  return `[[${noteNameFromPath(path)}]]`;
}

/** The filesystem path a descriptor would MOVE (Row 73): notes + folders from the sidebar, and a
 *  tab/pane that carries its file path. Null when the descriptor isn't backed by a vault path
 *  (e.g. a chat/terminal/graph tab). Extension-agnostic — any file or folder can be moved. */
export function descriptorMovePath(d: DragDescriptor | null): string | null {
  if (!d) return null;
  if (d.kind === "note" || d.kind === "folder") return d.path;
  if (d.kind === "tab" || d.kind === "pane") return d.path ?? null;
  return null;
}

/** The path a descriptor can be REFERENCED by (Row 74 chat mention / editor wikilink): a markdown
 *  note only — folders and non-markdown files (`.sheet`/`.draw`/…) return null. */
export function descriptorNotePath(d: DragDescriptor | null): string | null {
  if (!d || d.kind === "folder") return null;
  const p = descriptorMovePath(d);
  return p && isMarkdown(p) ? p : null;
}
