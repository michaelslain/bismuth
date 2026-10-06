// The PIN between three things that must agree: the token registry (core/src/theme/designTokens.ts),
// the `:root` blocks of global.css, and what settingsToCssVars(DEFAULTS) projects. A var added to
// one without the others fails here, with the var's name.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    DESIGN_TOKENS,
    UNREGISTERED_ROOT_VARS,
    tokenDef,
} from '../../core/src/theme/designTokens'
import { settingsToCssVars } from './settingsCssVars'
import { DEFAULTS } from './settings'
import { resolveAppearance } from './themes'

const CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'global.css'),
    'utf8',
)
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** `:root { … }` blocks: anywhere a selector can start (line start, indented, or after another rule
 *  on the same line), but not `.x:root` or `a-:root`. The body stops at the first `}`. */
const ROOT_BLOCK = /(?<![\w.#[\]-]):root\s*\{([^}]*)\}/g

/** Every `--x: value` declared in a `:root { … }` block, comments stripped (newlines kept). The last
 *  declaration of a block may omit its `;`. */
function rootDecls(): { decls: Record<string, string>; blocks: number } {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    const decls: Record<string, string> = {}
    let blocks = 0
    for (const block of css.matchAll(ROOT_BLOCK)) {
        blocks++
        for (const d of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+?)\s*(?:;|$)/gi))
            decls[d[1]] = norm(d[2])
    }
    return { decls, blocks }
}

const unregistered = (name: string) =>
    Object.keys(UNREGISTERED_ROOT_VARS).some(k =>
        k.endsWith('*') ? name.startsWith(k.slice(0, -1)) : k === name,
    )
const known = (name: string) =>
    tokenDef(name.slice(2)) !== undefined || unregistered(name)

const { decls: declared, blocks: rootBlocks } = rootDecls()
const projected = settingsToCssVars(DEFAULTS)

describe('token registry pin', () => {
    it('reads some :root declarations (the parser is not silently empty)', () => {
        expect(Object.keys(declared).length).toBeGreaterThan(150)
        // the regex finding fewer blocks than global.css really has is how a var goes unchecked
        expect(rootBlocks).toBeGreaterThanOrEqual(5)
    })

    it('every :root var in global.css is a token or listed as unregistered', () => {
        expect(Object.keys(declared).filter(n => !known(n))).toEqual([])
    })

    it('a token that global.css declares has the declared value as its default', () => {
        const wrong: string[] = []
        for (const d of DESIGN_TOKENS) {
            const css = declared[`--${d.key}`]
            if (css === undefined) continue
            // field + legacy-setting tokens, and anything the projection owns, take the projected value
            if (d.field || d.setting || `--${d.key}` in projected) continue
            if (css !== d.default) wrong.push(`${d.key}: css ${css} != default ${d.default}`)
        }
        expect(wrong).toEqual([])
    })

    it('every var settingsToCssVars emits is a token or unregistered', () => {
        expect(Object.keys(projected).filter(n => !known(n))).toEqual([])
    })

    it('a projected token defaults to what the projection emits (font tokens carry the family name)', () => {
        const wrong: string[] = []
        for (const d of DESIGN_TOKENS) {
            const p = projected[`--${d.key}`]
            if (p === undefined || d.kind === 'font-mono' || d.kind === 'font-prose')
                continue
            if (norm(p) !== d.default) wrong.push(`${d.key}: projected ${p} != default ${d.default}`)
        }
        expect(wrong).toEqual([])
    })

    it('a font token defaults to the schema default family', () => {
        expect(tokenDef('ui-font-stack')?.default).toBe(DEFAULTS.appearance.uiFont)
        expect(tokenDef('prose-font')?.default).toBe(DEFAULTS.appearance.proseFont)
    })

    it('every field token is projected, so its default is pinned to ink', () => {
        const missing = DESIGN_TOKENS.filter(
            d => d.field && d.field !== 'isLight' && !(`--${d.key}` in projected),
        ).map(d => d.key)
        expect(missing).toEqual([])
    })

    it('a token set through app/src/themes.ts reaches the resolved colours', () => {
        expect(
            resolveAppearance({ theme: 'ink', tokens: { accent: '#ff0000' } }).accent,
        ).toBe('#ff0000')
        expect(resolveAppearance({ theme: 'ink' }).accent).toBe('#93BDB0')
    })
})
