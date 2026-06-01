// app/src/editor/contextMenu.ts
// ONE context-menu path for every editor mark — spelling, grammar, and
// property/settings validation. Right-clicking a diagnostic emits a single
// `oa-context-menu` event that App renders with the shared <ContextMenu>
// component, so all menus look and behave identically. Right-clicking off a mark
// returns false, so the normal pane context menu opens instead.
import { forEachDiagnostic, forceLinting, type Action } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type EditorMenuItem = { label: string; onSelect: () => void; disabled?: boolean; icon?: string };
export type EditorMenuEvent = { x: number; y: number; items: EditorMenuItem[] };

export function editorContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
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
          // dict/ignore don't change the doc, so nudge a re-lint to clear the mark.
          setTimeout(() => forceLinting(view), 50);
          view.focus();
        },
      }));
      // No actionable fix (e.g. "expected a number") → show the message as a
      // non-clickable (disabled) row, not a fake action.
      if (!items.length) items.push({ label: hit.message, onSelect: () => {}, disabled: true });

      window.dispatchEvent(new CustomEvent<EditorMenuEvent>("oa-context-menu", { detail: { x: event.clientX, y: event.clientY, items } }));
      return true;
    },
  });
}
