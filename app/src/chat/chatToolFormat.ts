// app/src/chat/chatToolFormat.ts
// Pure formatting for a tool call's input — moved verbatim out of ChatView.tsx (~280-318), where it
// fed both the tool chip's one-line summary and its expanded raw-input view. No framework imports;
// unit-tested directly (chatToolFormat.test.ts).

/** One-line summary of a tool's input for the chip label (the path / command / query / url). */
export function summarizeInput(input: unknown): string {
    if (input == null) return ''
    if (typeof input === 'string') return input
    if (typeof input !== 'object') return String(input)
    const o = input as Record<string, unknown>
    // The fields most tools key their intent on, in priority order.
    for (const k of [
        'command',
        'file_path',
        'path',
        'pattern',
        'query',
        'url',
        'prompt',
        'description',
        'old_string',
        'content',
    ]) {
        const v = o[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
    }
    try {
        return JSON.stringify(input)
    } catch {
        return ''
    }
}

/** Pretty-print a tool's input for the expanded chip view. */
export function prettyInput(input: unknown): string {
    if (typeof input === 'string') return input
    try {
        return JSON.stringify(input, null, 2)
    } catch {
        return String(input)
    }
}
