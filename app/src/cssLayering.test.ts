// Guards the ONE rule that makes the CSS modularization safe: a class emitted as a runtime string
// literal (markdown renderer, editor decorations, export) can never be DEFINED in a CSS Module,
// because module class names are hashed at build time while those emitters keep writing the plain
// literal. If one migrates by mistake, every rendered note silently loses its styling — and no
// typecheck, no unit test and no console warning sees it. The only symptom is a note that looks
// slightly wrong to a human who happens to open it.
//
// The sanctioned exception is `:global(...)`: names inside it are NOT hashed, which is exactly why
// bases/BaseView.module.css and bases/CardEditModal.module.css already style `.bismuth-task-box`
// and `.cm-editor` from inside modules and are correct to do so. This file allows that form and
// only that form, so the check has real work to do against the code as it stands rather than
// passing vacuously.
//
// The rest of the file pins the shape Task 3 of the modularization established: App.css is an
// import manifest for the three global stylesheets plus a shrinking pile of component chrome.
import { describe, it, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = import.meta.dir

/** Prefixes written as literals into generated HTML. Source of truth: bases/markdown.ts,
 *  editor/livePreview.ts, editor/inlineMarkdown.ts, editor/bismuthWord.ts, editor/cellList.ts,
 *  editor/queryBlock.ts, export/. */
export const RUNTIME_CLASS_PREFIXES = ['bismuth-', 'callout-', 'cm-']

/** Ceiling on the class rules still living in App.css — a RATCHET, not a target. Each later task
 *  of the modularization moves a group out and lowers this number; the plan's endpoint is 40.
 *  It exists so the pile can only shrink: adding a rule to App.css instead of to a module fails
 *  here immediately, which is the regression this refactor is most exposed to. */
export const MAX_APP_CSS_CLASS_RULES = 306

const allFiles = (dir: string, acc: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        const p = join(dir, e.name)
        if (e.isDirectory()) allFiles(p, acc)
        else acc.push(p)
    }
    return acc
}

/** Strip CSS comments. Prose mentioning a class (BaseView.module.css documents `.cm-task-checkbox`
 *  in a comment) is not a definition, and counting it would make the check cry wolf. */
const stripComments = (css: string): string =>
    css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Strip `:global(...)` regions, matching parens so nested ones survive — the codebase really does
 *  write `:global(li:has(> .bismuth-task-box))`, which a lazy `\([^)]*\)` would cut in half and
 *  then flag the tail of. */
function stripGlobal(css: string): string {
    let out = ''
    let i = 0
    for (;;) {
        const at = css.indexOf(':global(', i)
        if (at < 0) return out + css.slice(i)
        out += css.slice(i, at)
        let depth = 0
        let j = at + ':global'.length
        for (; j < css.length; j++) {
            if (css[j] === '(') depth++
            else if (css[j] === ')' && --depth === 0) break
        }
        i = j + 1 // drop the whole :global(...) region
    }
}

/** Runtime-prefixed class names DEFINED (i.e. outside `:global`) in `css`. */
function runtimeClassesDefinedIn(css: string): string[] {
    const scanned = stripGlobal(stripComments(css))
    const hits: string[] = []
    for (const pre of RUNTIME_CLASS_PREFIXES) {
        const re = new RegExp(`\\.${pre}[a-zA-Z0-9_-]+`, 'g')
        for (const m of scanned.match(re) ?? []) hits.push(m)
    }
    return hits
}

const modules = allFiles(SRC).filter(f => f.endsWith('.module.css'))
const appCss = readFileSync(join(SRC, 'App.css'), 'utf8')

describe('css layering — runtime classes stay out of CSS Modules', () => {
    it('finds the modules it is supposed to be guarding', () => {
        // Without this the suite passes vacuously the day the glob or the extension convention moves.
        expect(modules.length).toBeGreaterThan(0)
        expect(modules.map(f => f.slice(SRC.length + 1))).toContain(
            'bases/BaseView.module.css',
        )
    })

    it('no runtime-emitted class is DEFINED in a CSS Module', () => {
        const offenders: string[] = []
        for (const f of modules) {
            for (const hit of runtimeClassesDefinedIn(
                readFileSync(f, 'utf8'),
            )) {
                offenders.push(`${f.slice(SRC.length + 1)}: ${hit}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('modules use only the parenthesized `:global(...)` form', () => {
        // The bare switch form (`:global .foo { }`) escapes hashing too, but stripGlobal above cannot
        // see where it ends — so it would hide a real offender. Ban it rather than guess its extent.
        const bare = modules
            .filter(f =>
                /:global(?!\()/.test(stripComments(readFileSync(f, 'utf8'))),
            )
            .map(f => f.slice(SRC.length + 1))
        expect(bare).toEqual([])
    })

    it('the scanner catches an offender and forgives the sanctioned form', () => {
        // Both directions, against text shaped like the real files — a check that only ever runs on
        // green code proves nothing about what it would do on red code.
        expect(
            runtimeClassesDefinedIn(
                '.card :global(.bismuth-task-box) { color: red; }',
            ),
        ).toEqual([])
        expect(
            runtimeClassesDefinedIn(
                '.card :global(li:has(> .cm-tag)) { color: red; }',
            ),
        ).toEqual([])
        expect(
            runtimeClassesDefinedIn(
                '/* styles .bismuth-tag like the editor */\n.card { color: red; }',
            ),
        ).toEqual([])
        expect(runtimeClassesDefinedIn('.bismuth-tag { color: red; }')).toEqual(
            ['.bismuth-tag'],
        )
        expect(
            runtimeClassesDefinedIn(
                '.card :global(.cm-x) { }\n.callout-note { }',
            ),
        ).toEqual(['.callout-note'])
    })
})

describe('css layering — App.css is the global manifest', () => {
    it('imports the three global stylesheets before anything else', () => {
        // `@import` hoists anyway, but a rule written ABOVE these lines reads as if it ran first and
        // will be reasoned about wrongly by the next person to move something.
        const firstRule = appCss.search(/^[^\s@].*\{/m)
        const lastImport = appCss.lastIndexOf('@import "./styles/')
        for (const f of ['tokens', 'reset', 'content']) {
            expect(appCss, `imports styles/${f}.css`).toContain(
                `@import "./styles/${f}.css";`,
            )
        }
        expect(lastImport).toBeGreaterThan(-1)
        expect(firstRule, 'a rule precedes the @import block').toBeGreaterThan(
            lastImport,
        )
    })

    it('declares no design token — those live in styles/tokens.css', () => {
        // A stray `:root` here would out-order the token file (imports hoist) and win, which is how a
        // first-paint fallback quietly stops matching the theme it is supposed to mirror.
        expect(stripComments(appCss)).not.toContain(':root')
        expect(stripComments(appCss)).not.toContain('@property')
    })

    it('declares no runtime-emitted class — those live in styles/content.css', () => {
        expect(runtimeClassesDefinedIn(appCss)).toEqual([])
    })

    it('its remaining class-rule pile only ever shrinks', () => {
        const rules = appCss.match(/^\.[a-zA-Z][^{\n]*\{/gm) ?? []
        expect(
            rules.length,
            `App.css declares ${rules.length} class rules (ceiling ${MAX_APP_CSS_CLASS_RULES}); ` +
                `moving rules out should LOWER MAX_APP_CSS_CLASS_RULES, never raise it`,
        ).toBeLessThanOrEqual(MAX_APP_CSS_CLASS_RULES)
    })
})
