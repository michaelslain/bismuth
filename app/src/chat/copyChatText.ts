// app/src/chat/copyChatText.ts — plain module, no framework imports beyond pushToast.
// Copies raw text (never rendered HTML) to the clipboard and toasts the result. Shared by
// ChatCopyButton's hover-reveal control on every bubble, ChatTranscript's bubble right-click-menu
// "Copy" item and ChatAuthPanel's "copy command" action (which passes its own toast wording).
import { pushToast } from '../ui/toastStore'

export function copyChatText(
    text: string,
    messages: { ok?: string; fail?: string } = {},
): void {
    navigator.clipboard
        .writeText(text)
        .then(() => pushToast(messages.ok ?? 'Copied'))
        .catch(() => pushToast(messages.fail ?? "Couldn't copy"))
}
