// app/src/editor/relint.ts
// Force a lint re-run when the DOCUMENT hasn't changed.
//
// CM6's forceLinting() only promotes an *already-pending* lint to run immediately:
// the lint plugin's internal `set` flag is true only between a doc edit and the next
// run, and false once a run settles. So calling forceLinting() on an idle, settled
// editor is a silent no-op (see @codemirror/lint `force()` — `if (this.set) …`).
//
// That breaks every quick-fix that changes LINTER STATE without editing the document:
// Harper's "Add to dictionary" / "Ignore" (mutate the personal dictionary / ignore
// list) and the property-registry revalidation (Editor.tsx). The diagnostic source
// would now return fewer marks, but nothing asks it to re-run, so stale squiggles
// linger until the next keystroke.
//
// Mechanism: linters opt in via `needsRefresh: relintNeedsRefresh` in their config.
// requestRelint() dispatches `relintEffect` — a no-op transaction the lint plugin's
// update() recognises (via needsRefresh) to mark a fresh run pending — then calls
// forceLinting() to run it at once. One plugin runs ALL sources, so a single request
// revalidates every active linter.
import { StateEffect } from "@codemirror/state";
import { forceLinting } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";

/** Marker effect carrying no payload; its presence on a transaction is the signal. */
export const relintEffect = StateEffect.define<null>();

/** A linter `needsRefresh` predicate: true when a transaction carried `relintEffect`. */
export function relintNeedsRefresh(update: ViewUpdate): boolean {
  return update.transactions.some((tr) =>
    tr.effects.some((e) => e.is(relintEffect)),
  );
}

/** Re-run lint sources now, even with no document change. For state-only quick fixes
 *  (add-to-dictionary, ignore) and external-state revalidation (property registry). */
export function requestRelint(view: EditorView): void {
  view.dispatch({ effects: relintEffect.of(null) });
  forceLinting(view);
}
