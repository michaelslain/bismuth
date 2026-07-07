// app/src/editor/saveReconcile.ts
//
// Pure three-way merge for the note-autosave conflict path (#46 — DATA LOSS bug: "changes
// sometimes don't save and the file autoreverts to a recent change but not the newest change").
//
// Root cause: Editor.tsx's autosave was an unconditional last-write-wins PUT /file — whenever
// the debounced save timer fired, it wrote whatever the LOCAL buffer held, with no regard for
// whether disk had moved on since the buffer was loaded/last reconciled. Two lost-update windows
// followed:
//   - An external writer's change lands WHILE a local edit is pending (the SSE reconcile effect
//     deliberately skips reloading disk while `pendingSave` is true, to avoid clobbering in-flight
//     typing — see the comment on that effect in Editor.tsx). The pending autosave then later
//     writes the STALE (pre-external-edit) buffer straight over the newer disk content, silently
//     destroying the external edit. This is exactly the live evidence: an external CLI typo-fix
//     landing while the note was open, gone minutes later.
//   - The mirror image: an idle buffer picks up nothing because the reload path is fine, but a
//     spuriously-marked-dirty buffer (any dispatch that flips `docChanged`, even a content-neutral
//     one) re-enters the same window and reverts the user's own newest keystrokes to the buffer's
//     older snapshot once disk changes elsewhere.
//
// The fix is a light three-way merge, not a full diff/patch library: `minimalChange` (already used
// elsewhere in Editor.tsx for frontmatter normalization + SSE reconciliation) finds the single
// contiguous span that turns one string into another via common-prefix/suffix trimming. That's
// enough to isolate "what the user typed" (base → local) and "what changed on disk" (base → disk)
// as two ranges, and — the common case for a large table-heavy note edited by both a human and an
// external process in different sections — merge them when they don't overlap. When they DO
// overlap (a genuine simultaneous edit to the same span), we don't attempt a token-level merge:
// that's ambiguous, and guessing wrong silently destroys someone's edit. Instead we keep the local
// text (never revert what the user is actively looking at) and flag `conflict: true` so the caller
// can surface it instead of pretending nothing happened.
import { minimalChange } from "./normalizeFrontmatter";

export interface MergeResult {
  /** The text to persist (and, if it differs from the caller's `local`, to reconcile into the
   *  visible buffer so what's on screen matches what's now on disk). */
  text: string;
  /** True when local and external edits touched OVERLAPPING spans — `text` is `local` verbatim
   *  (the user's in-progress edit is never silently reverted), but the disk's conflicting region
   *  was NOT incorporated. The caller should surface this rather than stay silent. */
  conflict: boolean;
}

/**
 * Reconcile a pending local save against the LATEST disk content, given the disk content the
 * local buffer was originally derived from (`base`).
 *
 *  - Neither side changed since `base` → nothing to merge (`local`, trivially also `disk`).
 *  - Only `disk` changed (idle buffer, pure external edit) → adopt `disk` — the external edit is
 *    the one that should win; there's no local edit to lose.
 *  - Only `local` changed (the common single-writer case) → `local` wins outright.
 *  - BOTH changed, in DISJOINT regions → merge both edits onto `base` (neither side is lost).
 *  - BOTH changed, in OVERLAPPING regions → keep `local`, `conflict: true` (ambiguous; surfaced,
 *    never silently resolved).
 */
export function threeWayMerge(base: string, local: string, disk: string): MergeResult {
  if (disk === base) return { text: local, conflict: false };
  if (local === base) return { text: disk, conflict: false };
  if (local === disk) return { text: disk, conflict: false };

  const localDiff = minimalChange(base, local);
  const diskDiff = minimalChange(base, disk);

  const disjoint = localDiff.to <= diskDiff.from || diskDiff.to <= localDiff.from;
  if (!disjoint) return { text: local, conflict: true };

  const merged =
    localDiff.from <= diskDiff.from
      ? base.slice(0, localDiff.from) +
        localDiff.insert +
        base.slice(localDiff.to, diskDiff.from) +
        diskDiff.insert +
        base.slice(diskDiff.to)
      : base.slice(0, diskDiff.from) +
        diskDiff.insert +
        base.slice(diskDiff.to, localDiff.from) +
        localDiff.insert +
        base.slice(localDiff.to);
  return { text: merged, conflict: false };
}
