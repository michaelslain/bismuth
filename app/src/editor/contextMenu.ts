// app/src/editor/contextMenu.ts
// ONE context-menu path for the note editor. A right-click ANYWHERE in the editor
// pops the shared <ContextMenu> (via the `bismuth-context-menu` event App listens
// for) with: any spelling/grammar/property fix actions for the mark under the
// cursor, and standard Copy / Cut / Paste — so replacing the native menu loses
// nothing. Right-clicking a task checkbox still defers to the checkbox status menu.
//
// The emoji library is NOT one of those rows: it rides the menu's QUICK-ACTION RAIL
// (`quickActions`, drawn beside the menu to its left) so it can't get buried under the
// options — see editor/emojiQuickAction.ts for the full #67 rationale.
import { forEachDiagnostic, type Action } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { requestRelint } from "./relint";
import { emojiQuickAction, type QuickActionSpec } from "./emojiQuickAction";

export type EditorMenuItem = { label: string; onSelect: () => void; disabled?: boolean; icon?: string; separatorBefore?: boolean };
export type EditorMenuEvent = { x: number; y: number; items: EditorMenuItem[]; quickActions?: QuickActionSpec[] };

export function editorContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      // A task checkbox owns its own right-click (the status menu in livePreview's
      // contextmenu handler). This handler has higher precedence, and posAtCoords on
      // the checkbox replace-widget resolves to the start of the task TEXT — which falls
      // inside the first word's spelling/grammar squiggle when that word is misspelled.
      // Bail so the checkbox handler downstream gets the event.
      if ((event.target as HTMLElement).closest(".cm-task-checkbox")) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });

      // Fix actions for any diagnostic mark under the cursor (spelling / grammar /
      // property validation). Empty when the click landed off a mark.
      const hits: { from: number; to: number; message: string; actions: readonly Action[] }[] = [];
      if (pos != null) {
        forEachDiagnostic(view.state, (d, from, to) => {
          if (pos >= from && pos <= to) hits.push({ from, to, message: d.message, actions: d.actions ?? [] });
        });
      }

      event.preventDefault();
      event.stopPropagation(); // don't also pop the pane's onContextMenu menu

      // Move the caret to where they clicked, but only when there's no active selection —
      // so the emoji / Paste land at the click point, while a right-click on a
      // deliberately-selected range (to Copy/Cut it) keeps that selection intact.
      const hadSelection = !view.state.selection.main.empty;
      if (!hadSelection && pos != null) view.dispatch({ selection: { anchor: pos } });

      const items: EditorMenuItem[] = [];

      // 1) Diagnostic fixes for the mark under the cursor (when there is one).
      const hit = hits.length ? hits[hits.length - 1] : null;
      if (hit) {
        for (const a of hit.actions) {
          items.push({
            label: a.name,
            icon: "Wrench",
            onSelect: () => {
              a.apply(view, hit.from, hit.to);
              // dict/ignore actions change linter state, not the doc, so a doc-change can't
              // drive the re-lint; requestRelint forces the sources to re-run. Harper's
              // WorkerLinter serializes worker messages FIFO, so the dictionary/ignore
              // mutation enqueued in apply() is processed before this re-lint's lint() call;
              // the small delay is just margin.
              setTimeout(() => requestRelint(view), 50);
              view.focus();
            },
          });
        }
        // No actionable fix (e.g. "expected a number") → show the message as a
        // non-clickable (disabled) row, not a fake action.
        if (!hit.actions.length) items.push({ label: hit.message, onSelect: () => {}, disabled: true });
      }

      // 2) Standard clipboard actions, so replacing the native menu loses nothing.
      items.push({
        label: "Copy",
        icon: "Copy",
        separatorBefore: items.length > 0,
        disabled: !hadSelection,
        onSelect: () => {
          const { from, to } = view.state.selection.main;
          const text = view.state.sliceDoc(from, to);
          if (text) void navigator.clipboard?.writeText(text);
          view.focus();
        },
      });
      items.push({
        label: "Cut",
        icon: "Scissors",
        disabled: !hadSelection,
        onSelect: () => {
          const { from, to } = view.state.selection.main;
          const text = view.state.sliceDoc(from, to);
          if (text) {
            void navigator.clipboard?.writeText(text);
            view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
          }
          view.focus();
        },
      });
      items.push({
        label: "Paste",
        icon: "Clipboard",
        onSelect: () => {
          view.focus();
          void navigator.clipboard?.readText().then((text) => {
            if (!text) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
          }).catch(() => {/* clipboard blocked — no-op */});
        },
      });

      window.dispatchEvent(
        new CustomEvent<EditorMenuEvent>("bismuth-context-menu", {
          // No `insert` — App's default (the last-focused note editor's caret) is this view.
          detail: { x: event.clientX, y: event.clientY, items, quickActions: [emojiQuickAction({ focus: () => view.focus() })] },
        }),
      );
      return true;
    },
  });
}
