// app/src/editor/rebuildSeed.ts
//
// Which text a REBUILT CodeMirror view starts from.
//
// Editor.tsx creates its view inside a `createEffect`, and that effect re-runs for the SAME
// buffer — every `settings.editor` leaf is a dependency, so a wrapping toggle or a font change
// tears the view down and builds a new one. Each run has to seed the new document from
// somewhere, and getting that source wrong is not a glitch, it is silent DATA LOSS: the buffer
// reverts, nothing reports it, and the next autosave writes the reverted text over the file.
//
// **`props.initialText` is not a live value.** FileView produces it with a `createResource` keyed
// on the PATH (`initialText={body()}`), so it is read once when the note opens and never
// refreshed — not after an autosave, not after an SSE reload. Seeding a same-buffer rebuild from
// it therefore discards every edit made since the note was opened. Measured in the running app:
// open a note, drag a standalone drawing to a new slot (`drawBlock.ts`'s reorder, which lands on
// disk within a second), then enter draw mode. The drawing jumped back to where it started and
// the reorder was gone from the file — the buffer had been reseeded from the open-time snapshot,
// and the first ink commit persisted it.
//
// So the rule here is that the seed CANNOT BE STALE, rather than that it gets refreshed in one
// more place. The view being torn down is the authority on its own buffer, so Editor.tsx carries
// that view's live document across the rebuild and hands it back here.
//
// `initialText` still wins in the one case where the buffer genuinely cannot know better: when
// the prop has CHANGED since the last build. That is a caller handing down different content for
// the same path — InboxPageView swapping a page body — and the live document has no way to
// represent it.
//
// No CodeMirror, no Solid, no DOM: this is a three-branch decision that used to live as an
// untestable `if` in a 1900-line component, and the branch that was wrong was the one nothing
// could assert.

/** Where a rebuilt view's document comes from.
 *
 *  The SOURCE is part of the answer, not just the text. Two sources can carry equal strings and
 *  still be different decisions, and a test that only compared the text would pass under either
 *  — which is exactly how the stale branch survived. */
export type RebuildSeed =
    | { from: 'carried'; text: string }
    | { from: 'initial'; text: string }
    | { from: 'fetch' }

/**
 * @param carried    the live document of the view being replaced, or `null` when there is none to
 *                   carry — a first build, or a rebuild for a DIFFERENT path (the caller keys it
 *                   by path, because another buffer's text is not this buffer's text).
 * @param initialText      `props.initialText` as it stands now.
 * @param builtInitialText `props.initialText` as it stood at the previous build of this buffer.
 */
export function rebuildSeed(
    carried: string | null,
    initialText: string | undefined,
    builtInitialText: string | undefined,
): RebuildSeed {
    // `!== null`, never a truthiness test: an EMPTY buffer is a buffer. A user who selected all
    // and deleted, then changed a setting, must not have their note handed back to them.
    if (carried !== null && initialText === builtInitialText) {
        return { from: 'carried', text: carried }
    }
    if (initialText !== undefined) return { from: 'initial', text: initialText }
    return { from: 'fetch' }
}
