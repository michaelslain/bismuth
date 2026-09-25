// app/src/chat/chatRowDrop.test.ts
//
// WHY THIS EXISTS. ChatControls' own collapse ladder (CLAUDE.md: "keeps its OWN, SEPARATE collapse
// ladder") is a `data-row-*` attribute ChatControls.tsx stamps on a control, matched by a selector
// inside an `@container chatrow` block in ChatControls.module.css. NOTHING connects the two other
// than both spelling the same string — tag a control `data-row-label` and forget the CSS rule (or
// typo either side) and the attribute lands on the DOM, matches nothing, and the control never
// collapses: no typecheck error, no failing test, no warning. Same family as
// ui/barDropLevels.test.ts (the `data-bar-drop` ladder) and bench/moduleClassCheck.ts (a hashed
// class that still compiles as a literal) — "the string is valid, the referent is missing".
//
// WHAT IT CANNOT SEE: a `data-row-*` name built at runtime (`data-row-${x}`) has no literal for the
// regex below to read — no call site does that today, and shouldn't, since the name is a fixed
// ladder rung, not a computed value.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TSX = join(import.meta.dir, 'ChatControls.tsx')
const CSS = join(import.meta.dir, 'ChatControls.module.css')

const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Every `data-row-<name>` attribute literally written in the component (bare or `={true}`, JSX
 *  boolean-attribute shapes — none of today's usages take a value). */
const rowAttrNames = (tsx: string): Set<string> => {
    const re = /\bdata-row-([a-z]+)\b/g
    return new Set([...stripComments(tsx).matchAll(re)].map(m => m[1]))
}

/** The `@container chatrow { ... }` block bodies, brace-balanced (the stylesheet may hold more than
 *  one tier/block someday) — a flat regex can't handle the nested `.row [data-row-x] { … }` rule
 *  inside, so this walks braces by hand. */
const containerChatrowBodies = (css: string): string[] => {
    const clean = stripComments(css)
    const bodies: string[] = []
    const marker = /@container\s+chatrow\b[^{]*\{/g
    let m: RegExpExecArray | null
    while ((m = marker.exec(clean))) {
        let depth = 1
        let i = marker.lastIndex
        const start = i
        while (i < clean.length && depth > 0) {
            if (clean[i] === '{') depth++
            else if (clean[i] === '}') depth--
            i++
        }
        bodies.push(clean.slice(start, i - 1))
        marker.lastIndex = i
    }
    return bodies
}

test('every data-row-* hook ChatControls.tsx writes is matched by a rule inside @container chatrow', () => {
    const tsx = readFileSync(TSX, 'utf8')
    const css = readFileSync(CSS, 'utf8')

    const written = rowAttrNames(tsx)
    // Anti-vacuity: if this ever reads zero, the regex (or the component) drifted and the test
    // would otherwise pass by having nothing to check.
    expect(written.size).toBeGreaterThan(0)

    const bodies = containerChatrowBodies(css)
    expect(bodies.length).toBeGreaterThan(0)
    const matched = bodies.join('\n')

    for (const name of written) {
        expect(matched).toContain(`[data-row-${name}]`)
    }
})
