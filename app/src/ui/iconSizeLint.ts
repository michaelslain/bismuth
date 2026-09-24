// The ONE-icon-size guard (appearance.iconSize, 2026-09-24). Pure: no framework, no fs — the test
// hands it file text. Every icon reads the one size from ui/iconSize.ts through the primitives'
// defaults, so a size written at a call site is drift. The app had six sizes (11–17px) before this
// guard existed, all from call sites that each looked reasonable on their own.

/** Components whose `size` / `iconSize` prop sets an icon glyph. */
export const ICON_TAGS: ReadonlySet<string> = new Set([
    'Icon',
    'IconButton',
    'IconTextButton',
    'IconBar',
    'Chip',
    'VBtn',
    'CommandButton',
])

/** The marker that lets one literal through — an oversized illustration mark, never chrome. It
 *  must carry a reason and sit on the attribute's line or within the 3 lines above it. */
export const EXEMPT_MARKER = 'icon-size-exempt:'

export type IconSizeViolation = { line: number; tag: string; attr: string }

const ATTR = /\b(iconSize|size)=\{([^{}]*)\}/g
// A value that just forwards the caller's own prop is a primitive passing a size through, not a
// call site choosing one.
const PASSTHROUGH = /^\s*(props|local|own)\.[A-Za-z]+\s*$/

/** Every `size={…}` / `iconSize={…}` on an icon component in `text` that is not a pass-through
 *  and not marked exempt. The tag is the nearest `<Name` before the attribute. */
export function findIconSizeViolations(text: string): IconSizeViolation[] {
    const lines = text.split('\n')
    const lineOf = (index: number) => text.slice(0, index).split('\n').length
    const out: IconSizeViolation[] = []
    for (const m of text.matchAll(ATTR)) {
        const attr = m[1]!
        const value = m[2]!
        if (PASSTHROUGH.test(value)) continue
        const before = text.slice(0, m.index)
        const tag = [...before.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].pop()?.[1]
        if (!tag || !ICON_TAGS.has(tag)) continue
        // `size` on these components is a glyph size only when numeric-ish; `iconSize` always is.
        if (attr === 'size' && !/^\s*[0-9A-Z_]/.test(value)) continue
        const line = lineOf(m.index!)
        const window = lines.slice(Math.max(0, line - 4), line).join('\n')
        if (window.includes(EXEMPT_MARKER)) continue
        out.push({ line, tag, attr: `${attr}={${value}}` })
    }
    return out
}
