// app/src/ui/iconBracketsGuard.ts
// Pure detectors behind the ICON-BRACKET guard (iconBrackets.test.ts). Brackets on an icon-only
// control mean ON, so state is never shown by swapping the glyph, a toggle's off state is never
// `normal`, `selected` is never emphasis, and delete / remove / close have their own controls.
// No framework, no DOM: each function takes file text and returns findings with a 1-based line.

export type IconBracketRule = 'icon-swap' | 'selected-literal' | 'toggle-normal' | 'trash-or-x'

export type IconBracketFinding = { rule: IconBracketRule; line: number; text: string }

export type JsxTag = { name: string; start: number; attrs: Record<string, string> }

/** Blanks `//` and block comments (keeping newlines) so offsets and line numbers stay true.
 *  String and template literals are copied through untouched, so `'http://x'` is not a comment.
 *  A `//` starts a comment only at the start of a line or right after `;` `,` `{` `(` `)`. */
export function blankComments(text: string): string {
    let out = ''
    let i = 0
    while (i < text.length) {
        const c = text[i]!
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1
            while (j < text.length && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1
            const end = Math.min(j + 1, text.length)
            out += text.slice(i, end)
            i = end
        } else if (c === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2)
            const end = close < 0 ? text.length : close + 2
            out += text.slice(i, end).replace(/[^\n]/g, ' ')
            i = end
        } else if (c === '/' && text[i + 1] === '/' && /(^|[;,{()])\s*$/.test(out.slice(out.lastIndexOf('\n') + 1))) {
            let end = text.indexOf('\n', i)
            if (end < 0) end = text.length
            out += ' '.repeat(end - i)
            i = end
        } else {
            out += c
            i++
        }
    }
    return out
}

function lineAt(text: string, index: number): number {
    let line = 1
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
    return line
}

/** Every `<IconButton …>` / `<IconTextButton …>` opening tag, parsed whole: the tag ends at the
 *  first `>` outside `{…}` (nested braces, `=>` and string literals tolerated) and outside a
 *  quoted attribute value. Attribute values come back raw: `"Eye"` keeps its quotes, `{a ? b : c}`
 *  keeps its braces. */
export function iconTags(text: string): JsxTag[] {
    const tags: JsxTag[] = []
    const open = /<(IconButton|IconTextButton)(?![\w.])/g
    for (const m of text.matchAll(open)) {
        const start = m.index!
        let i = start + m[0].length
        const attrs: Record<string, string> = {}
        while (i < text.length) {
            const c = text[i]!
            if (c === '>') break
            if (c === '/' && text[i + 1] === '>') break
            if (!/[A-Za-z_]/.test(c)) {
                if (c === '{') i = skipBraces(text, i) // {...spread}
                else i++
                continue
            }
            let j = i
            while (j < text.length && /[\w:-]/.test(text[j]!)) j++
            const name = text.slice(i, j)
            while (/\s/.test(text[j] ?? '')) j++
            if (text[j] !== '=') {
                attrs[name] = ''
                i = j
                continue
            }
            j++
            while (/\s/.test(text[j] ?? '')) j++
            const q = text[j]
            let end: number
            if (q === '"' || q === "'") end = text.indexOf(q, j + 1) + 1
            else if (q === '{') end = skipBraces(text, j)
            else end = j + 1
            attrs[name] = text.slice(j, end)
            i = end
        }
        tags.push({ name: m[1]!, start, attrs })
    }
    return tags
}

/** Index just past the `}` matching the `{` at `from`, skipping strings and template literals. */
function skipBraces(text: string, from: number): number {
    let depth = 0
    for (let i = from; i < text.length; i++) {
        const c = text[i]!
        if (c === '"' || c === "'" || c === '`') {
            i++
            while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
            continue
        }
        if (c === '{') depth++
        else if (c === '}' && --depth === 0) return i + 1
    }
    return text.length
}

/** True when a `{…}` expression holds a ternary (a `?` that is not `?.` / `??`, and a `:`). */
function isTernary(expr: string): boolean {
    const bare = expr.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
    return /\?(?![.?])/.test(bare.replace(/\?\?/g, '')) && bare.includes(':')
}

/** The icon-bracket findings in `text` (comments are blanked first). `inUi` marks a file under
 *  `app/src/ui/`, where `variant="selected"` literals are the primitives' own business. */
export function iconBracketFindings(source: string, inUi: boolean): IconBracketFinding[] {
    const text = blankComments(source)
    const out: IconBracketFinding[] = []
    const add = (rule: IconBracketRule, index: number) =>
        out.push({ rule, line: lineAt(text, index), text: text.slice(index).split('\n')[0]!.trim() })

    for (const tag of iconTags(text)) {
        const icon = tag.attrs.icon
        if (tag.name === 'IconButton' && icon !== undefined) {
            if (icon.startsWith('{') && isTernary(icon)) add('icon-swap', tag.start)
            const lit = /^\{?\s*["']([^"']*)["']\s*\}?$/.exec(icon)?.[1]
            if (lit !== undefined && /^(?:L[iu])?(trash[\w-]*|x)$/i.test(lit)) add('trash-or-x', tag.start)
        }
        if (!inUi && /^\{?\s*["']selected["']\s*\}?$/.test(tag.attrs.variant ?? '')) add('selected-literal', tag.start)
    }
    // a toggle whose off state is `normal`, in either order, in any ternary (inline or a helper)
    const toggle = /\?\s*(?:['"]selected['"]\s*:\s*['"]normal['"]|['"]normal['"]\s*:\s*['"]selected['"])/g
    for (const m of text.matchAll(toggle)) add('toggle-normal', m.index!)
    // BarTwin's own spelling of the same off state
    for (const m of text.matchAll(/\boffVariant\s*=\s*\{?\s*['"]normal['"]/g)) add('toggle-normal', m.index!)
    return out.sort((a, b) => a.line - b.line)
}
