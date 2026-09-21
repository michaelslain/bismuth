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
// The rest of the file pins the shape Task 3 of the modularization established, updated by Task 14
// (one-global-stylesheet): the twelve former global files (App.css, Editor.css, Terminal.css,
// ui/ui.css, styles/{tokens,reset,content}.css, graph/asciiGraph.css, palette/switcher.css,
// ui/popover/popover.css, sheet/univer-{theme,icons}.css) are now ONE file, global.css, each former
// file its own clearly commented section. The former `@import` HOISTING of tokens/reset/content
// ahead of App.css's body is now just textual order in one file — this suite still pins that a
// former-App.css rule can never precede the tokens/reset/content sections, since that ordering is
// exactly what used to be invisible (the imports hoisted regardless of where they sat in the file).
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
 *  here immediately, which is the regression this refactor is most exposed to.
 *
 *  9, after the pinned-rail fix (2026-09-02): the eight above plus
 *  `.layout.has-rail.rail-pinned:not(.switcher-active)`. This is the ONE direction in which this
 *  number may legitimately rise: the rule is page FRAME (it sets a `grid-template-columns` track on
 *  `.layout` itself), the same family as `.layout.has-rail` and `.layout.has-rail.switcher-active`
 *  directly above it, and there is no component whose module could own it — `--rail-w` is consumed
 *  by the PARENT's grid, so setting it from shell/TabRail.module.css would do nothing at all.
 *  Component chrome arriving here is still the regression this guards.
 *
 *  8, after Tasks 6/9/11 (2026-08): `.app-shell`, `.app-shell .layout`, `.asc-wordmark`, `.layout`,
 *  `.layout.has-rail`, `.layout.has-rail.switcher-active`, `.layout.sidebar-hidden`,
 *  `.graph-slot-main` — the page frame, which owns no single component and stays global on
 *  purpose (see App.css's own pointer comments for why each one is frame, not chrome). */
export const MAX_APP_CSS_CLASS_RULES = 9

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
const globalCss = readFileSync(join(SRC, 'global.css'), 'utf8')

/** Section markers written by the Task 14 merge ("* <title> \n * ====" banner comments). Each
 *  former file is its own section; slicing between two markers recovers exactly what that file's
 *  content used to be, so the checks below can still ask their old, file-scoped questions. */
const sectionStart = (title: string): number => {
    const at = globalCss.indexOf(title)
    if (at < 0) throw new Error(`section not found in global.css: ${title}`)
    return at
}
const tokensAt = sectionStart('styles/tokens.css — design tokens')
const resetAt = sectionStart('styles/reset.css — element reset')
const contentAt = sectionStart('styles/content.css — runtime-emitted classes')
const appShellAt = sectionStart('App.css — app shell chrome')
const uiCssAt = sectionStart('ui/ui.css — shared design-system primitives')
// The App.css section runs from its own banner to the next section's banner (ui/ui.css).
const appCss = globalCss.slice(appShellAt, uiCssAt)

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

describe('css layering — global.css keeps the hoisted order', () => {
    it('places tokens, reset and content before the App.css section, in that order', () => {
        // These three used to be `@import`ed by App.css, and `@import` HOISTS — so the browser ran
        // them ahead of App.css's own body regardless of where the import lines sat in the file. Now
        // that they are one file, textual order IS effective order, so this is the ordering that
        // reproduces the old hoisted cascade: get it wrong and every rule below silently changes
        // precedence with nothing to report it.
        expect(tokensAt, 'tokens section precedes reset section').toBeLessThan(
            resetAt,
        )
        expect(resetAt, 'reset section precedes content section').toBeLessThan(
            contentAt,
        )
        expect(
            contentAt,
            'content section precedes the App.css section',
        ).toBeLessThan(appShellAt)
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
