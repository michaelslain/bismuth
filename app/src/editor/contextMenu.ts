// app/src/editor/contextMenu.ts
// ONE context-menu path for every editor mark — spelling, grammar, and
// property/settings validation. Right-clicking a diagnostic emits a single
// `bismuth-context-menu` event that App renders with the shared <ContextMenu>
// component, so all menus look and behave identically. Right-clicking off a mark
// returns false, so the normal pane context menu opens instead.
import { forEachDiagnostic, type Action } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { requestRelint } from "./relint";

export type EditorMenuItem = { label: string; onSelect: () => void; disabled?: boolean; icon?: string };
export type EditorMenuEvent = { x: number; y: number; items: EditorMenuItem[] };

export function editorContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      // A task checkbox owns its own right-click (the status menu in livePreview's
      // contextmenu handler). This diagnostic handler has higher precedence, and
      // posAtCoords on the checkbox replace-widget resolves to the start of the task
      // TEXT — which falls inside the first word's spelling/grammar squiggle when that
      // word is misspelled. Without this guard the spelling menu would intercept (and
      // stopPropagation) the right-click, so the checkbox status menu never opens. Bail
      // so the checkbox handler downstream gets the event.
      if ((event.target as HTMLElement).closest(".cm-task-checkbox")) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      const hits: { from: number; to: number; message: string; actions: readonly Action[] }[] = [];
      forEachDiagnostic(view.state, (d, from, to) => {
        if (pos >= from && pos <= to) hits.push({ from, to, message: d.message, actions: d.actions ?? [] });
      });
      if (!hits.length) return false; // off a mark → let the pane menu open

      const hit = hits[hits.length - 1];
      event.preventDefault();
      event.stopPropagation(); // don't also pop the pane's onContextMenu menu

      const items: EditorMenuItem[] = hit.actions.map((a) => ({
        label: a.name,
        icon: "Wrench",
        onSelect: () => {
          a.apply(view, hit.from, hit.to);
          // dict/ignore change linter state, not the doc, so a doc-change can't drive
          // the re-lint; requestRelint forces the sources to re-run. Ordering is safe
          // regardless of the delay: Harper's WorkerLinter serializes worker messages
          // FIFO, so the dictionary/ignore mutation enqueued inside apply() is processed
          // before this re-lint's lint() call. The small delay is just margin.
          setTimeout(() => requestRelint(view), 50);
          view.focus();
        },
      }));
      // No actionable fix (e.g. "expected a number") → show the message as a
      // non-clickable (disabled) row, not a fake action.
      if (!items.length) items.push({ label: hit.message, onSelect: () => {}, disabled: true });

      window.dispatchEvent(new CustomEvent<EditorMenuEvent>("bismuth-context-menu", { detail: { x: event.clientX, y: event.clientY, items } }));
      return true;
    },
  });
}
