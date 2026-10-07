// app/src/ui/_hoverRules.ts — story fixture: what a `:hover` rule would paint on an element.
// `:hover` follows the real pointer and cannot be held from a play(), so a play proves a hover
// claim ("a clickable row never paints a background on hover") from the live CSSOM instead: every
// `:hover` rule whose selector WOULD match the element once the pointer is over it, and the
// properties it sets. Pure DOM reads, no framework.

export type HoverDecl = { selector: string; prop: string; value: string }

/** Split a selector list on its top-level commas (a `:not(a, b)` keeps its own). */
function splitSelectors(text: string): string[] {
    const out: string[] = []
    let depth = 0
    let from = 0
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (c === ',' && depth === 0) {
            out.push(text.slice(from, i).trim())
            from = i + 1
        }
    }
    out.push(text.slice(from).trim())
    return out
}

/** Every declaration, in every `:hover` rule of the live stylesheets, that applies to `el` while the
 *  pointer is over it. A rule whose `:hover` sits on an ancestor (`.a:hover .b`) is tested with the
 *  `:hover` removed, so it counts for `.b` when `.a` is the hovered thing. */
export function hoverDeclarations(el: Element): HoverDecl[] {
    const found: HoverDecl[] = []
    const walk = (list: CSSRuleList) => {
        for (const r of Array.from(list)) {
            if (r instanceof CSSStyleRule) {
                for (const sel of splitSelectors(r.selectorText)) {
                    if (!sel.includes(':hover')) continue
                    let matches = false
                    try {
                        matches = el.matches(sel.replace(/:hover/g, ''))
                    } catch {
                        /* a selector the engine rejects once :hover is stripped: not ours */
                    }
                    if (!matches) continue
                    for (const prop of Array.from(r.style))
                        found.push({
                            selector: sel,
                            prop,
                            value: r.style.getPropertyValue(prop),
                        })
                }
            } else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules)
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules)
        } catch {
            /* a cross-origin sheet: not ours */
        }
    }
    return found
}

/** The properties (not declarations) a hover would set on `el` whose name starts with `prefix`. */
export const hoverProps = (el: Element, prefix: string): string[] =>
    hoverDeclarations(el)
        .map(d => d.prop)
        .filter(p => p.startsWith(prefix))
