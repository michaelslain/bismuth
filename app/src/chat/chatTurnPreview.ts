// app/src/chat/chatTurnPreview.ts — pure, no framework imports.
// The one line a collapsed chat turn keeps beside its label: the message's first line of prose,
// with the markdown marks that would read as noise in a single muted line taken off.

const BLOCK_PREFIX_RE =
    /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/
const FENCE_RE = /^\s*(`{3,}|~{3,})/

/** First non-blank, non-fence line of `text`, without block prefixes (`#`, `-`, `>`, `1.`) or
 *  inline marks (`**`, `__`, backticks, `[[ ]]`). Empty when the text has no such line. */
export function chatTurnPreview(text: string): string {
    let inFence = false
    for (const raw of text.split('\n')) {
        if (FENCE_RE.test(raw)) {
            inFence = !inFence
            continue
        }
        if (inFence || !raw.trim()) continue
        return raw
            .replace(BLOCK_PREFIX_RE, '')
            .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/(\*\*|__|`)/g, '')
            .trim()
    }
    return ''
}
