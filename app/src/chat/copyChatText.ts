// app/src/chat/copyChatText.ts — plain module, no framework imports beyond pushToast.
// Copies raw text (never rendered HTML) to the clipboard and toasts the result. Shared by
// ChatCopyButton's hover-reveal control on every bubble and ChatTranscript's bubble
// right-click-menu "Copy" item — previously two identical, independently-drifting copies.
import { pushToast } from '../Toast'

export function copyChatText(text: string): void {
    navigator.clipboard
        .writeText(text)
        .then(() => pushToast('Copied'))
        .catch(() => pushToast("Couldn't copy"))
}
