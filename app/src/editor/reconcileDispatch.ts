// Shared builder for every dispatch that pulls DISK content into the buffer (SSE
// reconcile of an external write, save()'s three-way-merge residue, autosave's
// frontmatter normalization). Two invariants, both #46 regressions when violated:
//
// 1. `ExternalReload` annotation — the autosave listener skips these transactions,
//    so reloading an external change never triggers a save that writes the file
//    back to itself (an endless loop against a busy external writer).
// 2. `addToHistory: false` — disk content must be INVISIBLE to undo. Before this,
//    every external reconcile became an undo step: cmd+z restored a pre-reload
//    disk snapshot, the autosave then persisted that regression, and the file
//    "autoreverted to a recent change but not the newest change". CodeMirror's
//    history maps pending undo steps across non-history changes (the standard
//    remote-changes contract), so user edits stay cleanly undoable around them.
import { Annotation, Transaction, type TransactionSpec } from "@codemirror/state";
import { minimalChange } from "./normalizeFrontmatter";

// Marks a transaction as "content pulled in from disk" rather than a user edit.
export const ExternalReload = Annotation.define<boolean>();

// Smallest-span patch from `current` to `next`, annotated per the invariants above.
export function externalReconcileSpec(current: string, next: string): TransactionSpec {
  return {
    changes: minimalChange(current, next),
    annotations: [ExternalReload.of(true), Transaction.addToHistory.of(false)],
  };
}
