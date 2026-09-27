// app/src/chat/chatDrop.ts
// What a chat surface does with a draggable — pure, no Solid, no DOM. Every drop onto a chat (the
// chat tab or the daemon page's inline chat) normalises to a `ChatDropAction`, whatever it came
// from: an OS file (real path), a browser `File` (bytes, no path), a paths-less drag read off the
// pasteboard (browser image, link, text), or an in-app draggable (sidebar row, tab, pane) that
// names a vault path. `chatActionsFromPlan` maps the note-side planner's `DropAction[]`
// (dropIntake.ts) onto these, so notes and chats read a drag the same way.
// The full source × surface matrix: docs/overview/draggables.md.
import type { DropAction } from '../dropIntake'
import { bytesFromBase64 } from '../dropIntake'

export type ChatDropAction =
    | { kind: 'paths'; paths: string[] }
    | { kind: 'files'; files: File[] }
    | { kind: 'text'; text: string }
    | { kind: 'mention'; path: string; noteIds: string[] }

/** The session methods a drop needs — a ChatSession satisfies it. */
export type ChatDropSink = {
    addDroppedPaths: (paths: string[]) => Promise<void>
    addDroppedFiles: (files: File[]) => Promise<void>
    addDroppedText: (text: string) => void
    addMention: (path: string, noteIds: string[]) => void
}

/** Map a pasteboard plan onto chat actions. A remote image a chat cannot attach without fetching it
 *  is handed over as its URL text — the model can still open it, and nothing is silently lost. */
export function chatActionsFromPlan(plan: DropAction[]): ChatDropAction[] {
    const out: ChatDropAction[] = []
    for (const a of plan) {
        if (a.kind === 'paths') out.push({ kind: 'paths', paths: a.paths })
        else if (a.kind === 'bytes')
            out.push({
                kind: 'files',
                files: [
                    new File([bytesFromBase64(a.base64) as BlobPart], a.name),
                ],
            })
        else if (a.kind === 'url-image' || a.kind === 'link')
            out.push({ kind: 'text', text: a.url })
        else out.push({ kind: 'text', text: a.text })
    }
    return out
}

export async function applyChatDrop(
    sink: ChatDropSink,
    action: ChatDropAction,
): Promise<void> {
    switch (action.kind) {
        case 'paths':
            return sink.addDroppedPaths(action.paths)
        case 'files':
            return sink.addDroppedFiles(action.files)
        case 'text':
            return sink.addDroppedText(action.text)
        case 'mention':
            return sink.addMention(action.path, action.noteIds)
    }
}
