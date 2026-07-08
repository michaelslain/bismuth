// app/src/chatQueueRestore.ts
// Pure "what should Stop hand back to the composer" logic, split out of ChatView.tsx (like
// chatEditorContext.ts) so it's unit-testable headlessly. Row 83: stopping a chat mid-turn used to
// DELETE any still-queued follow-up messages (setQueuedTurns([]) + splice their bubbles). The fix
// restores their original text — and any staged image attachments — into the composer instead, so
// nothing the user typed while the model was working gets thrown away.

/** The subset of a queued turn's shape this module needs: the ORIGINAL typed text (not the wire
 *  message, which has the editor-context preamble merged in) and whatever images were staged with
 *  it. Kept minimal/generic so ChatView.tsx's `Attachment` type doesn't need to be imported here. */
export interface RestorableQueuedTurn<TImage> {
  text: string;
  images: readonly TImage[];
}

export interface RestoredComposerState<TImage> {
  text: string;
  images: TImage[];
}

/** Given the turns still queued when Stop is pressed and the composer's current (in-progress)
 *  draft/attachments, compute what the composer should hold afterward: queued text joined oldest
 *  first (blank-line separated) and PREPENDED above whatever the user was already typing — mirrors
 *  how "Reply" quotes text above the draft (see replyToMessage in ChatView.tsx) — plus queued image
 *  attachments prepended ahead of the composer's current ones. An empty queue is a no-op passthrough
 *  (returns `current` as-is, just copying the images array). */
export function restoreQueuedComposerState<TImage>(
  queued: readonly RestorableQueuedTurn<TImage>[],
  current: { text: string; images: readonly TImage[] },
): RestoredComposerState<TImage> {
  if (!queued.length) return { text: current.text, images: [...current.images] };
  const restoredText = queued
    .map((q) => q.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const text = !restoredText ? current.text : current.text ? `${restoredText}\n\n${current.text}` : restoredText;
  const images = [...queued.flatMap((q) => q.images), ...current.images];
  return { text, images };
}
