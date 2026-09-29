// Pure inline-markdown parser for a task description: wikilinks, [label](url) links, #tags,
// **bold** and *italic*. Rendering lives in TaskText.tsx.
export type TaskInlineSegment =
    | { kind: 'text'; text: string }
    | { kind: 'wikilink'; target: string; label: string }
    | { kind: 'link'; url: string; label: string }
    | { kind: 'tag'; name: string }
    | { kind: 'bold'; text: string }
    | { kind: 'italic'; text: string }

const INLINE_RE =
    /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(^|\s)#([A-Za-z0-9_/-]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g

export function parseTaskInline(src: string): TaskInlineSegment[] {
    const out: TaskInlineSegment[] = []
    const pushText = (text: string) => {
        if (text) out.push({ kind: 'text', text })
    }
    let last = 0
    let m: RegExpExecArray | null
    INLINE_RE.lastIndex = 0
    while ((m = INLINE_RE.exec(src))) {
        pushText(src.slice(last, m.index))
        if (m[1] !== undefined) {
            const [target, display] = m[1].split('|')
            const label = display ?? target.split('/').pop() ?? target
            out.push({ kind: 'wikilink', target, label })
        } else if (m[2] !== undefined) {
            out.push({ kind: 'link', url: m[3], label: m[2] })
        } else if (m[5] !== undefined) {
            pushText(m[4]) // preserve the whitespace captured before the tag
            out.push({ kind: 'tag', name: m[5] })
        } else if (m[6] !== undefined) {
            out.push({ kind: 'bold', text: m[6] })
        } else if (m[7] !== undefined) {
            out.push({ kind: 'italic', text: m[7] })
        }
        last = INLINE_RE.lastIndex
    }
    pushText(src.slice(last))
    return out
}
