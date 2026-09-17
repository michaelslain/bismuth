// app/src/ui/_fontFace.ts
// Story-only assertion helpers: "this element renders in the note PROSE face" and "…in the
// EDITOR's mono face, at the editor size".
//
// Note prose, chat message bodies and note tables paint in --prose-font (CMU Serif), the ONE
// proportional exception to the app's single mono family — see CLAUDE.md's Typography note and
// styles/tokens.css. Everything pulled back out of prose (code, frontmatter, #tags) paints in
// --editor-font at --editor-font-size. Several story files (Editor, ChatView, …) each had a
// verbatim copy of the prose check with the `first()` helper redefined; the tag unification
// added more surfaces, which is what made this a shared module.
//
// Asserted against the LIVE tokens, never a literal family name or pixel size: hardcoding
// "CMU Serif" or 13.5 would keep passing if the token were repointed or the user changed
// appearance.editorFontSize (range 11-28), and that is the regression worth catching.
import { expect } from 'storybook/test'

/** The first family in a CSS font stack, unquoted and trimmed. */
export function firstFamily(stack: string): string {
    return stack.split(',')[0]!.replace(/["']/g, '').trim()
}

function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Assert `el` resolves to the same first family as the `--prose-font` token. */
export function expectProseFace(el: HTMLElement): void {
    const prose = token('--prose-font')
    // A missing/empty token would make the comparison vacuously true on both sides.
    expect(prose.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(prose))
}

/** Assert `el` resolves to the same first family as the `--ui-font-stack` token. */
export function expectUiFace(el: HTMLElement): void {
    const ui = token('--ui-font-stack')
    expect(ui.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(ui))
}

/** Assert `el` renders at exactly `--editor-font-size`, not a scaled multiple of it. */
export function expectEditorSize(el: HTMLElement): void {
    const px = parseFloat(token('--editor-font-size'))
    expect(Number.isFinite(px) && px > 0).toBe(true)
    expect(parseFloat(getComputedStyle(el).fontSize)).toBe(px)
}

/** Assert `el`'s family is bound to the `--ui-font-stack` TOKEN, not merely equal to its value.
 *
 *  --ui-font-stack and --prose-font resolve to visibly different families, so a naive equality
 *  check on the resolved value would already catch most drift — but repointing the TOKEN itself
 *  is what proves the rule is actually a live `var()` reference rather than a literal that
 *  happens to match today's default. The probe name never has to exist as a real font:
 *  getComputedStyle reports the declared stack, not what the system resolved.
 *
 *  Repoints via document.documentElement.style, matching how settingsCssVars.ts's setCssVars
 *  actually writes every token (root.style.setProperty), so this reads back through the same
 *  cascade path the app itself uses. The restore is in a `finally` — a failing assertion here
 *  must not leave the probe family bound to --ui-font-stack for every story that runs after it
 *  in the same Storybook session. */
export function expectBoundToUiFont(el: HTMLElement): void {
    const root = document.documentElement
    const saved = root.style.getPropertyValue('--ui-font-stack')
    try {
        root.style.setProperty('--ui-font-stack', 'UiFontBindingProbe, monospace')
        expect(firstFamily(getComputedStyle(el).fontFamily)).toBe('UiFontBindingProbe')
    } finally {
        if (saved) root.style.setProperty('--ui-font-stack', saved)
        else root.style.removeProperty('--ui-font-stack')
    }
}
