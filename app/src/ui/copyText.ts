// app/src/ui/copyText.ts — plain module, no framework imports beyond pushToast.
// THE one clipboard write for the app's copy controls: copies raw text (never rendered HTML) and
// toasts the result either way, since navigator.clipboard can reject (permissions, an insecure
// context). Shared by every copy control: CodeHeader (a code block in a note or a chat message),
// ChatCopyButton, the transcript's "Copy" menu item, and the copy-command/copy-path actions (which
// pass their own wording).
import { pushToast } from './toastStore'

export function copyText(
    text: string,
    messages: { ok?: string; fail?: string } = {},
): void {
    if (!navigator.clipboard) {
        pushToast(messages.fail ?? "Couldn't copy")
        return
    }
    // The clipboard refuses a write from an unfocused document. A copy button cancels its mousedown
    // (so it never steals a note editor's selection), which also stops an embedding frame — a
    // Storybook preview, a webview inside another page — from taking focus on the click. Focusing
    // the window inside the click's own gesture is allowed and lets the write through.
    if (!document.hasFocus()) window.focus()
    navigator.clipboard
        .writeText(text)
        .then(() => pushToast(messages.ok ?? 'Copied'))
        .catch(() => pushToast(messages.fail ?? "Couldn't copy"))
}
