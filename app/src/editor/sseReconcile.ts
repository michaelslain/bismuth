// app/src/editor/sseReconcile.ts
//
// What an SSE-triggered external-change reconcile should do with a just-completed disk read.
//
// The reconcile effect in Editor.tsx / BlockEditor.tsx starts an `await api.read(path)` gated
// on `pendingSave` being false AT THE MOMENT THE READ STARTS. But `path`'s buffer is live for the
// whole width of that await — a rename/move/create-driven SSE fires this read, and any keystroke
// or autosave that lands DURING it is invisible to a guard that only ran before the read began.
// Measured 3/3: text typed while the read is in flight gets removed from the visible buffer the
// instant the read resolves (the code used to reconcile unconditionally), the in-flight autosave
// then writes that reverted buffer to disk, and the *next* edit's three-way merge sees
// disk === its own merge anchor and happily overwrites — deleting the typed text a second time,
// this time from disk itself.
//
// The fix is not "read pendingSave again" alone — a keystroke that both starts a save AND changes
// the doc needs the same verdict as a keystroke that lands too fast for the debounce to have
// fired yet. So the buffer is compared against ITSELF, before and after the read, in addition to
// pendingSave: either signal means the read's evidence is stale and must be discarded outright,
// not merged from.
//
// Pure and framework-free so the fork in judgement — abort / noop / own-echo / reconcile — is
// testable without mounting either editor (Solid components can't mount under `bun test`).

export type SseReconcileDecision = 'abort' | 'noop' | 'own-echo' | 'reconcile'

export function decideSseReconcile(s: {
    /** Whether a save was pending (or became pending) by the time the disk read resolved —
     *  checked AGAIN here because it can flip from false to true during the read's await. */
    pendingSaveAfterRead: boolean
    /** The buffer's text at the moment the read was kicked off. */
    docBeforeRead: string
    /** The buffer's text right now, after the read resolved. */
    docAfterRead: string
    /** What the read returned. */
    onDisk: string
    /** The text of this buffer's own most recent save, if any — recognizes the echo of our own
     *  write so it is never mistaken for an external change. */
    lastSavedText: string | undefined
}): SseReconcileDecision {
    // The buffer moved (typed, or a save started) while we were awaiting the read: `onDisk` is
    // stale evidence about a buffer that no longer exists. Discard the read outright — do not
    // reconcile, and do not even treat it as a same-content no-op — so the caller leaves every
    // merge anchor untouched and lets the buffer's own pending/next save re-establish truth.
    if (s.pendingSaveAfterRead || s.docAfterRead !== s.docBeforeRead) return 'abort'
    if (s.docAfterRead === s.onDisk) return 'noop'
    if (s.onDisk === s.lastSavedText) return 'own-echo'
    return 'reconcile'
}
