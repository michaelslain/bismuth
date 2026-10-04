// core/src/statusBarTemplate.ts — `{token}` templates for status bar text. PURE.

export type StatusVars = Record<string, string | number | undefined>

const TOKEN = /\{\{|\}\}|\{([a-z.]+)\}/g

/** Replaces `{name}` (name = [a-z.]+) with vars[name]; an unknown or undefined token renders ''.
 *  `{{` / `}}` are literal braces. Result trimmed. */
export function renderStatusTemplate(text: string, vars: StatusVars): string {
    return text
        .replace(TOKEN, (m, name?: string) => {
            if (m === '{{') return '{'
            if (m === '}}') return '}'
            const v = vars[name!]
            return v === undefined ? '' : String(v)
        })
        .trim()
}

/** The token names a template references (for lazy stat computation). */
export function templateTokens(text: string): Set<string> {
    const out = new Set<string>()
    for (const m of text.matchAll(TOKEN)) if (m[1]) out.add(m[1])
    return out
}
