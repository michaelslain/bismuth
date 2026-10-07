// app/src/icons/iconUsage.test.ts
//
// THE GUARD AGAINST A CALL SITE ASKING FOR AN ICON THAT DOES NOT EXIST. The `AllIcons` story loops
// the keys of ICON_MAP and checks each resolves — which is true by construction, so it can never
// catch the real bug: a call site holding a name that is NOT a key (`'EyeOff'`, a Lucide name, in a
// Phosphor repo). This test goes the other way round. It scans every non-test source file under
// app/src for literal icon names at their real call shapes and asserts `resolveIcon(name)` is
// non-null for each one.
//
// Shapes scanned (string literals only, including every literal in a ternary or a returned chain):
//   icon="X"   icon={cond ? 'A' : 'B'}   icon: 'X'   icon: cond ? 'A' : 'B'
//   <Icon value="X">   <Icon value={cond ? 'A' : 'B'}>
//   function/const whose NAME contains "icon" (`visibilityMenuIcon`, `iconFor`) — every literal in
//   a result position (after `return`, `?`, `:` or `=>`) of its body is treated as an icon name.
//
// NOT SEEN, by design: a name held in a variable, built from a template string, or read from data
// (a vault note's `icon:` frontmatter is user input and MUST fall back gracefully). Those are
// skipped, not failed. Literals after a comparison (`=== 'hidden'`) are never taken as names.
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveIcon } from './registry'

const SRC = join(import.meta.dir, '..')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(e => {
        const p = join(dir, e)
        if (e === 'node_modules' || e === 'assets') return []
        if (statSync(p).isDirectory()) return walk(p)
        return /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : []
    })

/** Components whose `icon` prop is a logo-mark basename (`/logos/<icon>.svg`), not a registry name. */
const LOGO_MARK_COMPONENTS = /<(?:WordmarkHero)[^>]*$/

const NOT_ICONS = new Set(['true', 'false', 'none', 'auto', 'all', 'one'])

const NAME = /^[A-Za-z][\w-]*$/

/** Every string literal in `expr` that is a RESULT (not the right-hand side of a comparison). */
function literalsIn(expr: string): { name: string; offset: number }[] {
    const out: { name: string; offset: number }[] = []
    const re = /(["'])([^"'\n]*)\1/g
    let m: RegExpExecArray | null
    while ((m = re.exec(expr))) {
        const before = expr.slice(0, m.index).trimEnd()
        if (/(?:[=!]=|[<>]=?|\(|\[|,|\bcase|\bin|\bof)$/.test(before)) continue
        if (!NAME.test(m[2]!)) continue
        out.push({ name: m[2]!, offset: m.index })
    }
    return out
}

/** The text from `start` (just past an opening `{`) to its matching `}`. */
function braced(text: string, start: number): string {
    let depth = 1
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}' && --depth === 0) return text.slice(start, i)
    }
    return text.slice(start)
}

type Hit = { name: string; index: number }

function scan(text: string): Hit[] {
    const hits: Hit[] = []
    const add = (expr: string, base: number) => {
        for (const l of literalsIn(expr))
            hits.push({ name: l.name, index: base + l.offset })
    }

    // icon="X" / icon={expr}
    for (const m of text.matchAll(/\bicon=(?:(["'])([^"']*)\1|\{)/g)) {
        const at = m.index! + m[0].length
        if (m[2] !== undefined) add(`'${m[2]}'`, at - m[2].length - 2)
        else add(braced(text, at), at)
    }
    // icon: expr   (to the end of the line / next comma / closing brace, ternaries stay whole)
    for (const m of text.matchAll(/\bicon:\s*([^,\n}]+)/g)) {
        if (m[1]!.trimStart().startsWith('{')) continue // a Storybook argType, not a name
        add(m[1]!, m.index! + m[0].length - m[1]!.length)
    }
    // <Icon ... value="X"> / value={expr}
    for (const m of text.matchAll(
        /<Icon\b[^>]*?\bvalue=(?:(["'])([^"']*)\1|\{)/g,
    )) {
        const at = m.index! + m[0].length
        if (m[2] !== undefined) add(`'${m[2]}'`, at - m[2].length - 2)
        else add(braced(text, at), at)
    }
    // function visibilityMenuIcon(...) { return a ? 'X' : 'Y' }  /  const iconFor = (...) => { ... }
    for (const m of text.matchAll(
        /\bfunction\s+\w*[Ii]con\w*\s*\([^)]*\)[^{;]*\{|\b(?:const|let)\s+\w*[Ii]con\w*\s*=\s*(?:\([^)]*\)|\w+)[^{;=]*=>\s*\{/g,
    )) {
        const at = m.index! + m[0].length
        const body = braced(text, at)
        for (const r of body.matchAll(
            /\breturn\b([\s\S]*?)(?=;|\n\s*\}|\n\s*(?:return|const|let|if|for)\b|$)/g,
        )) {
            // an object / JSX / template literal is markup, not a name
            if (/^\s*[{(<`]/.test(r[1]!)) continue
            add(r[1]!, at + r.index! + 'return'.length)
        }
    }
    return hits
}

test('every literal icon name at a call site in app/src resolves', () => {
    const misses: string[] = []
    let checked = 0
    for (const file of walk(SRC)) {
        const text = readFileSync(file, 'utf8')
        if (!/\bIcon\b|\bicon\b|Icon\w*\(/i.test(text)) continue
        const seen = new Set<string>()
        for (const { name, index } of scan(text)) {
            if (NOT_ICONS.has(name.toLowerCase())) continue
            if (
                LOGO_MARK_COMPONENTS.test(
                    text.slice(Math.max(0, index - 220), index),
                )
            )
                continue
            const line = text.slice(0, index).split('\n').length
            const key = `${name}@${line}`
            if (seen.has(key)) continue
            seen.add(key)
            checked++
            if (resolveIcon(name) === null)
                misses.push(
                    `${file.slice(SRC.length + 1)}:${line}  "${name}" is not an icon -> renders the dashed "?" fallback`,
                )
        }
    }
    console.log(`iconUsage: ${checked} literal icon names scanned`)
    expect(checked).toBeGreaterThan(50)
    expect(misses.join('\n')).toBe('')
})
